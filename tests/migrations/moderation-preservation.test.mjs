import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposableTarget } from "../../scripts/local-target.mjs";
import { applyPendingMigrations } from "../../scripts/local-test-stack.mjs";
import { snapshotM6Records } from "./milestone-7-preservation.test.mjs";
import {
  LAST_SESSION_END_MIGRATION, upgradeSql, assertMigrationBoundary, createUpgradeUser,
  upgradeRpc, answerUpgradeSession, captureReadyMedia,
} from "./session-end-preservation.test.mjs";

export const LAST_MODERATION_MIGRATION = "20261122000300";

export async function runModerationPreservation(env = process.env) {
  const target = assertDisposableTarget(env);
  assertMigrationBoundary(target, LAST_SESSION_END_MIGRATION);
  const learner = await createUpgradeUser(env), operator = await createUpgradeUser(env);
  const start = (await upgradeRpc(learner, "start_training_session", { p_request_id: randomUUID() })).session;
  const answered = await answerUpgradeSession(learner, start);
  const endInput = { p_session_id: start.id, p_request_id: randomUUID(), p_expected_revision: answered.session.revision };
  const ended = (await upgradeRpc(learner, "end_training_session", endInput)).session;
  const active = (await upgradeRpc(learner, "start_training_session", { p_request_id: randomUUID() })).session;
  const item = ended.items[0];
  const before = snapshotM6Records(target);
  const bytes = await captureReadyMedia(target, env);
  await applyPendingMigrations(target, { through: LAST_MODERATION_MIGRATION });
  assertMigrationBoundary(target, LAST_MODERATION_MIGRATION);
  assert.deepEqual(snapshotM6Records(target, before), before,
    "Moderation migration preserves every previous column, account, ended/active/completed run, attempt, receipt and immutable publication");
  assert.deepEqual(await captureReadyMedia(target, env), bytes, "Moderation preserves uploaded recording bytes");
  assert.equal(upgradeSql(target, "select count(*) from private.operator_memberships;"), "0", "Migration never grants operator access to existing users");
  assert.equal(await upgradeRpc(operator, "get_operator_access"), false);
  assert.equal(await upgradeRpc(learner, "get_operator_access"), false);
  for (const original of [ended, active]) {
    assert.deepEqual(await upgradeRpc(learner, "get_training_session", { p_session_id: original.id }), original);
  }
  assert.deepEqual((await upgradeRpc(learner, "end_training_session", endInput)).session, ended,
    "Earlier idempotent End receipts still resolve after moderation upgrade");
  const preview = await upgradeRpc(learner, "get_library_preview", { p_scenario_id: item.challenge.id });
  assert.equal(preview.contentVersion, item.challenge.contentVersion);
  const command = { p_request_id: randomUUID(), p_target: { kind: "session-item", sessionId: ended.id, itemId: item.id },
    p_category: "analysis_issue", p_detail: "Review the exact saved explanation after upgrade." };
  const report = await upgradeRpc(learner, "create_scenario_report", command);
  assert.equal(report.replayed, false);
  assert.equal(report.duplicate, false);
  assert.equal((await upgradeRpc(learner, "create_scenario_report", command)).replayed, true);
  const duplicate = await upgradeRpc(learner, "create_scenario_report", { ...command, p_request_id: randomUUID(), p_detail: "A repeated report must not replace the initial detail." });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.report.id, report.report.id);
  assert.equal((await learner.client.rpc("get_operator_report", { p_report_id: report.report.id })).error?.message, "OPERATOR_REQUIRED");

  // Trusted administration is confined to the already validated disposable target.
  assert.match(operator.id, /^[0-9a-f-]{36}$/);
  upgradeSql(target, `insert into private.operator_memberships(user_id) values ('${operator.id}'::uuid);`);
  assert.equal(await upgradeRpc(operator, "get_operator_access"), true);
  const detail = await upgradeRpc(operator, "get_operator_report", { p_report_id: report.report.id });
  assert.equal(detail.report.contentVersion, item.challenge.contentVersion);
  assert.equal(detail.report.detail, command.p_detail);
  assert.deepEqual(detail.media.challenge, item.challenge);
  assert.deepEqual(detail.media.reveal, item.answer.result.reveal);
  const hideCommand = { p_scenario_id: item.challenge.id, p_request_id: randomUUID(),
    p_expected_revision: detail.visibility.revision, p_hidden: true, p_reason: "Temporary upgrade verification hold." };
  const hidden = await upgradeRpc(operator, "set_operator_scenario_visibility", hideCommand);
  assert.equal(hidden.visibility.hidden, true);
  assert.equal((await upgradeRpc(operator, "set_operator_scenario_visibility", hideCommand)).replayed, true);
  const unavailable = await learner.client.rpc("get_library_preview", { p_scenario_id: item.challenge.id });
  assert.equal(unavailable.error?.message, "SCENARIO_UNAVAILABLE");
  assert.deepEqual(await upgradeRpc(learner, "get_training_session", { p_session_id: ended.id }), ended);
  assert.deepEqual(await upgradeRpc(learner, "get_training_session", { p_session_id: active.id }), active,
    "Operator hold does not rewrite or stop an existing pinned practice run");
  const newcomer = await createUpgradeUser(env);
  assert.equal((await newcomer.client.rpc("start_selected_training_session", { p_request_id: randomUUID(), p_target: { kind: "scenario", scenarioId: item.challenge.id } })).error?.message, "SCENARIO_UNAVAILABLE");
  const resolved = await upgradeRpc(operator, "resolve_scenario_report", { p_report_id: report.report.id, p_request_id: randomUUID(),
    p_expected_revision: detail.report.revision, p_resolution: "addressed", p_operator_note: "Private upgrade verification note." });
  assert.equal(resolved.report.status, "resolved");
  assert.equal((await upgradeRpc(operator, "get_operator_report", { p_report_id: report.report.id })).visibility.hidden, true,
    "Resolving a report is independent of the scenario hold");
  const restored = await upgradeRpc(operator, "set_operator_scenario_visibility", { ...hideCommand,
    p_request_id: randomUUID(), p_expected_revision: hidden.visibility.revision, p_hidden: false, p_reason: "Restore reviewed standalone scenario." });
  assert.equal(restored.visibility.hidden, false);
  assert.equal((await upgradeRpc(learner, "get_library_preview", { p_scenario_id: item.challenge.id })).contentVersion, item.challenge.contentVersion);
  assert.deepEqual(await upgradeRpc(learner, "get_training_session", { p_session_id: ended.id }), ended);
  upgradeSql(target, `update private.operator_memberships set revoked_at=now() where user_id='${operator.id}'::uuid;`);
  assert.equal(await upgradeRpc(operator, "get_operator_access"), false);
  assert.equal((await operator.client.rpc("get_operator_report", { p_report_id: report.report.id })).error?.message, "OPERATOR_REQUIRED");
  console.log("Moderation upgrade preserved ended/active history and real media; pinned reports, duplicate retries, independent holds and revoked operator checks passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runModerationPreservation();
