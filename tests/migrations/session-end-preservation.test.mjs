import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertDisposableTarget, cleanChildEnvironment } from "../../scripts/local-target.mjs";
import { applyPendingMigrations, assertDockerOwnership } from "../../scripts/local-test-stack.mjs";
import { snapshotM6Records } from "./milestone-7-preservation.test.mjs";

export const LAST_M9_MIGRATION = "20261121000400";
export const LAST_SESSION_END_MIGRATION = "20261122000100";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function upgradeSql(target, statement) {
  assertDockerOwnership(target);
  return execFileSync("docker", ["exec", "-i", `supabase_db_${target.projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-Atq", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", env: cleanChildEnvironment(), stdio: ["pipe", "pipe", "inherit"], maxBuffer: 16 * 1024 ** 2 }).trim();
}

export function assertMigrationBoundary(target, expected) {
  assert.equal(upgradeSql(target, "select version from supabase_migrations.schema_migrations order by version desc limit 1;"), expected,
    "Preservation must start at its exact previous schema, before its migration is applied");
}

export function upgradeClient(env, admin = false) {
  return createClient(env.SUPABASE_TEST_URL, admin ? env.SUPABASE_TEST_SERVICE_ROLE_KEY : env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function createUpgradeUser(env) {
  const email = `wyp-preservation-${randomUUID()}@example.test`, password = `LocalOnly-${randomUUID()}-A1`;
  const created = await upgradeClient(env, true).auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error?.message ?? null, null, "Create disposable verified upgrade fixture");
  const client = upgradeClient(env);
  assert.equal((await client.auth.signInWithPassword({ email, password })).error?.message ?? null, null);
  return { id: created.data.user.id, client };
}

export async function upgradeRpc(user, name, input = {}) {
  const response = await user.client.rpc(name, input);
  assert.equal(response.error?.message ?? null, null, `Upgrade RPC ${name} must succeed`);
  return response.data;
}

export async function answerUpgradeSession(user, session) {
  const item = session.items[session.currentIndex];
  const input = { p_session_id: session.id, p_item_id: item.id, p_option_id: item.challenge.options[0].id,
    p_request_id: randomUUID(), p_expected_revision: session.revision };
  return { input, session: (await upgradeRpc(user, "submit_session_answer", input)).session };
}

export async function advanceUpgradeSession(user, session) {
  return (await upgradeRpc(user, "advance_training_session", { p_session_id: session.id,
    p_from_item_id: session.items[session.currentIndex].id, p_request_id: randomUUID(), p_expected_revision: session.revision })).session;
}

export async function captureReadyMedia(target, env) {
  const objects = JSON.parse(upgradeSql(target, "select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',object_path) order by id),'[]') from private.video_assets where state='ready';"));
  assert.ok(objects.length > 0, "Earlier populated upgrades must supply actual validated recordings");
  const admin = upgradeClient(env, true);
  const hashes = [];
  for (const object of objects) {
    const result = await admin.storage.from(object.bucket).download(object.path);
    assert.equal(result.error?.message ?? null, null, "Preserved recording remains readable");
    hashes.push({ ...object, hash: digest(Buffer.from(await result.data.arrayBuffer())) });
  }
  return hashes;
}

export async function runSessionEndPreservation(env = process.env) {
  const target = assertDisposableTarget(env);
  assertMigrationBoundary(target, LAST_M9_MIGRATION);
  const setupUser = await createUpgradeUser(env), reviewUser = await createUpgradeUser(env), completedUser = await createUpgradeUser(env);
  const setup = (await upgradeRpc(setupUser, "start_training_session", { p_request_id: randomUUID() })).session;
  const reviewStart = (await upgradeRpc(reviewUser, "start_training_session", { p_request_id: randomUUID() })).session;
  const answered = await answerUpgradeSession(reviewUser, reviewStart);
  let completed = (await upgradeRpc(completedUser, "start_training_session", { p_request_id: randomUUID() })).session;
  while (completed.phase !== "completed") completed = completed.phase === "setup"
    ? (await answerUpgradeSession(completedUser, completed)).session : await advanceUpgradeSession(completedUser, completed);
  assert.ok(setup.items.length > 1);
  const before = snapshotM6Records(target);
  const mediaBefore = await captureReadyMedia(target, env);
  await applyPendingMigrations(target, { through: LAST_SESSION_END_MIGRATION });
  assertMigrationBoundary(target, LAST_SESSION_END_MIGRATION);
  assert.deepEqual(snapshotM6Records(target, before), before,
    "End-session migration preserves every old column/row, account, draft, review, command, immutable playlist and media reference");
  assert.deepEqual(await captureReadyMedia(target, env), mediaBefore, "Actual uploaded bytes survive without reseeding");
  for (const [user, original] of [[setupUser, setup], [reviewUser, answered.session], [completedUser, completed]]) {
    assert.deepEqual(await upgradeRpc(user, "get_training_session", { p_session_id: original.id }), { ...original, endedAt: null },
      "Previous snapshots gain only the explicit null end timestamp");
  }
  const input = { p_session_id: answered.session.id, p_request_id: randomUUID(), p_expected_revision: answered.session.revision };
  const ended = await upgradeRpc(reviewUser, "end_training_session", input);
  assert.equal(ended.session.status, "ended");
  assert.equal(ended.session.phase, "ended");
  assert.equal(ended.session.revision, 2);
  assert.equal(ended.session.currentIndex, null);
  assert.equal(ended.session.completedAt, null);
  assert.ok(ended.session.endedAt);
  assert.deepEqual(ended.session.items, answered.session.items, "End changes no pinned item or saved answer");
  const retried = await upgradeRpc(reviewUser, "end_training_session", input);
  assert.equal(retried.replayed, true);
  assert.deepEqual(retried.session, ended.session);
  const oldAnswer = await upgradeRpc(reviewUser, "submit_session_answer", answered.input);
  assert.equal(oldAnswer.replayed, true);
  assert.deepEqual(oldAnswer.session, ended.session, "Old command receipt returns current terminal state without changing its answer");
  const restarted = await upgradeRpc(reviewUser, "start_training_session", { p_request_id: randomUUID() });
  assert.notEqual(restarted.session.id, ended.session.id);
  const zero = await upgradeRpc(setupUser, "end_training_session", { p_session_id: setup.id, p_request_id: randomUUID(), p_expected_revision: 0 });
  assert.equal(zero.session.revision, 1);
  assert.equal(zero.session.items.filter(item => item.answer).length, 0);
  assert.deepEqual(await upgradeRpc(completedUser, "get_training_session", { p_session_id: completed.id }), { ...completed, endedAt: null });
  console.log("Session-end upgrade preserved all existing rows and uploaded bytes; zero/partial closure, canonical receipt replay and new starts passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runSessionEndPreservation();
