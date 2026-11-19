import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertDisposableTarget, cleanChildEnvironment } from "../../scripts/local-target.mjs";
import { applyPendingMigrations, assertDockerOwnership, LAST_M4_MIGRATION } from "../../scripts/local-test-stack.mjs";

function sql(target, statement) {
  assertDockerOwnership(target);
  return execFileSync("docker", ["exec", "-i", `supabase_db_${target.projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", env: cleanChildEnvironment(), stdio: ["pipe", "pipe", "inherit"] }).trim();
}
function client(env, admin = false) {
  return createClient(env.SUPABASE_TEST_URL, admin ? env.SUPABASE_TEST_SERVICE_ROLE_KEY : env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function rpc(user, name, input = {}) {
  const result = await user.client.rpc(name, input);
  assert.equal(result.error, null, `M5 upgrade RPC ${name} must succeed`);
  return result.data;
}
async function createUser(env, creator) {
  const email = `wyp-m5-upgrade-${randomUUID()}@example.test`, password = `LocalOnly-${randomUUID()}-A1`;
  const result = await client(env, true).auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(result.error, null);
  const user = { id: result.data.user.id, email, password, client: client(env) };
  assert.equal((await user.client.auth.signInWithPassword({ email, password })).error, null);
  if (creator) await rpc(user, "enable_creator");
  return user;
}
const checklist = Object.fromEntries([
  "povInformationChecked", "setupSpoilersChecked", "pauseTimingChecked", "continuationChecked",
  "normalSpeedAudioChecked", "alternativeChoicesChecked", "sourceAttributionChecked",
].map((key) => [key, true]));
async function createReviewedScenario(user, title, published) {
  const vectors = JSON.parse(readFileSync(new URL("../fixtures/creator-content-cases.json", import.meta.url), "utf8"));
  const content = { ...vectors.validContent, title };
  let scenario = (await rpc(user, "create_creator_scenario", { p_request_id: randomUUID() })).scenario;
  scenario = (await rpc(user, "save_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(), p_expected_revision: scenario.revision, p_content: content })).scenario;
  scenario = (await rpc(user, "review_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(), p_expected_revision: scenario.revision, p_checklist: checklist })).scenario;
  if (published) scenario = (await rpc(user, "publish_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(), p_expected_revision: scenario.revision, p_review_id: scenario.review.id })).scenario;
  return scenario;
}
async function startSingle(user, scenarioId) {
  const requestId = randomUUID();
  const result = await rpc(user, "start_selected_training_session", { p_request_id: requestId, p_target: { kind: "scenario", scenarioId } });
  return { session: result.session, requestId, scenarioId };
}
async function answer(user, session) {
  const item = session.items[session.currentIndex];
  return (await rpc(user, "submit_session_answer", { p_session_id: session.id, p_item_id: item.id,
    p_option_id: item.challenge.options[0].id, p_request_id: randomUUID(), p_expected_revision: session.revision })).session;
}
async function finish(user, session) {
  while (session.phase !== "completed") {
    const item = session.items[session.currentIndex];
    session = session.phase === "setup" ? await answer(user, session) :
      (await rpc(user, "advance_training_session", { p_session_id: session.id, p_from_item_id: item.id,
        p_request_id: randomUUID(), p_expected_revision: session.revision })).session;
  }
  return session;
}

export async function createM4Baseline(target, env) {
  assert.equal(Number(sql(target, `select count(*) from supabase_migrations.schema_migrations where version > '${LAST_M4_MIGRATION}';`)), 0,
    "Media upgrade must start on the actual milestone-four schema");
  assert.equal(sql(target, `select version from supabase_migrations.schema_migrations order by version desc limit 1;`), LAST_M4_MIGRATION);
  const creator = await createUser(env, true), second = await createUser(env, true), learner = await createUser(env, false);
  const live = await createReviewedScenario(creator, "M5 upgrade: published YouTube scenario", true);
  let withdrawn = await createReviewedScenario(creator, "M5 upgrade: pinned withdrawn scenario", true);
  const reviewed = await createReviewedScenario(second, "M5 upgrade: reviewed unpublished draft", false);
  const completed = await startSingle(creator, live.id);
  completed.session = await finish(creator, completed.session);
  const active = await startSingle(learner, withdrawn.id);
  withdrawn = (await rpc(creator, "unpublish_creator_scenario", { p_scenario_id: withdrawn.id, p_request_id: randomUUID(), p_expected_revision: withdrawn.revision })).scenario;
  assert.equal(withdrawn.publication.state, "withdrawn");
  assert.equal(active.session.phase, "setup");
  return { creator, second, learner, live, withdrawn, reviewed, completed, active };
}

export function snapshotM4Records(target) {
  const tables = ["public.profiles", "public.scenarios", "public.scenario_versions", "private.scenario_answer_keys",
    "private.scenario_drafts", "private.scenario_reviews", "private.creator_commands", "public.training_sessions",
    "public.training_session_items", "public.attempts", "private.session_commands"];
  const snapshots = Object.fromEntries(tables.map((table) => [table, JSON.parse(sql(target,
    `select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from (select to_jsonb(t) as value from ${table} t) records;`))]));
  snapshots.accounts = JSON.parse(sql(target, "select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from (select jsonb_build_object('id',id,'email',email,'confirmed',email_confirmed_at,'created',created_at) as value from auth.users) records;"));
  return snapshots;
}

export async function assertM4Preserved(target, before, baseline, env) {
  assert.deepEqual(snapshotM4Records(target), before, "Additive media upgrade preserves all existing account, draft, review, version, answer, session and receipt records");
  for (const user of [baseline.creator, baseline.second, baseline.learner]) {
    user.client = client(env);
    assert.equal((await user.client.auth.signInWithPassword({ email: user.email, password: user.password })).error, null);
  }
  for (const [user, original] of [[baseline.creator, baseline.live], [baseline.creator, baseline.withdrawn], [baseline.second, baseline.reviewed]]) {
    assert.deepEqual(await rpc(user, "get_creator_scenario", { p_scenario_id: original.id }), original);
  }
  for (const [user, entry] of [[baseline.creator, baseline.completed], [baseline.learner, baseline.active]]) {
    assert.deepEqual(await rpc(user, "get_training_session", { p_session_id: entry.session.id }), entry.session);
    const replay = await rpc(user, "start_selected_training_session", { p_request_id: entry.requestId, p_target: { kind: "scenario", scenarioId: entry.scenarioId } });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.session, entry.session);
  }
  const reviewed = baseline.reviewed;
  const noOp = (await rpc(baseline.second, "save_creator_scenario", { p_scenario_id: reviewed.id, p_request_id: randomUUID(),
    p_expected_revision: reviewed.revision, p_content: reviewed.draft.content })).scenario;
  // M4 records every explicit save as a new command revision/timestamp, even
  // when content is unchanged. Its content revision and review must survive.
  assert.deepEqual(noOp.draft.content, reviewed.draft.content);
  assert.equal(noOp.draft.revision, reviewed.draft.revision);
  assert.deepEqual(noOp.review, reviewed.review, "An unchanged legacy YouTube draft retains its exact review");
  assert.deepEqual(noOp.readiness, reviewed.readiness);
  assert.deepEqual(noOp.publication, reviewed.publication);
  assert.equal(noOp.revision, reviewed.revision + 1);
  const preview = await rpc(baseline.second, "get_creator_review_preview", { p_scenario_id: reviewed.id, p_revision: noOp.revision });
  assert.equal(preview.challenge.setup.kind, "youtube");
  const ended = await finish(baseline.learner, baseline.active.session);
  assert.equal(ended.phase, "completed", "A pre-upgrade session pinned to a withdrawn scenario can still finish");
  const denied = await baseline.learner.client.rpc("start_selected_training_session", { p_request_id: randomUUID(), p_target: { kind: "scenario", scenarioId: baseline.withdrawn.id } });
  assert.ok(denied.error, "Withdrawal still blocks a new start after the upgrade");
}

export async function runMediaMigrationPreservation(env = process.env) {
  const target = assertDisposableTarget(env);
  const baseline = await createM4Baseline(target, env), before = snapshotM4Records(target);
  await applyPendingMigrations(target);
  await assertM4Preserved(target, before, baseline, env);
  console.log("Media upgrade preservation passed: accounts, YouTube content/review digests, versions, receipts and saved sessions survived.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMediaMigrationPreservation();
}
