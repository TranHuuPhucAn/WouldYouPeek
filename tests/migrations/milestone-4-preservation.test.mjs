import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertDisposableTarget, cleanChildEnvironment } from "../../scripts/local-target.mjs";
import { applyPendingMigrations, assertDockerOwnership, LAST_M3_MIGRATION, LAST_M4_MIGRATION } from "../../scripts/local-test-stack.mjs";

function sql(target, statement) {
  assertDockerOwnership(target);
  return execFileSync("docker", ["exec", "-i", `supabase_db_${target.projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", env: cleanChildEnvironment(), stdio: ["pipe", "pipe", "inherit"] }).trim();
}
function client(env, admin = false) {
  return createClient(env.SUPABASE_TEST_URL, admin ? env.SUPABASE_TEST_SERVICE_ROLE_KEY : env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function rpc(user, name, input) {
  const result = await user.client.rpc(name, input);
  assert.equal(result.error, null, `Migration acceptance RPC ${name} must succeed`);
  return result.data;
}
async function answer(user, session) {
  const item = session.items[session.currentIndex];
  return (await rpc(user, "submit_session_answer", { p_session_id: session.id, p_item_id: item.id,
    p_option_id: item.challenge.options[0].id, p_request_id: randomUUID(), p_expected_revision: session.revision })).session;
}
async function advance(user, session) {
  return (await rpc(user, "advance_training_session", { p_session_id: session.id,
    p_from_item_id: session.items[session.currentIndex].id, p_request_id: randomUUID(), p_expected_revision: session.revision })).session;
}

export async function createM3Baseline(target, env) {
  const newer = Number(sql(target, `select count(*) from supabase_migrations.schema_migrations where version > '${LAST_M3_MIGRATION}';`));
  assert.equal(newer, 0, "Upgrade test must start on the actual milestone-three schema");
  const admin = client(env, true), users = [];
  for (let index = 0; index < 2; index++) {
    const email = `wyp-upgrade-${randomUUID()}@example.test`, password = `LocalOnly-${randomUUID()}-A1`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null, "Create disposable upgrade account");
    const user = { id: created.data.user.id, email, password, client: client(env), startRequest: randomUUID() };
    assert.equal((await user.client.auth.signInWithPassword({ email, password })).error, null);
    if (index === 0) await rpc(user, "enable_creator", {});
    let session = (await rpc(user, "start_training_session", { p_request_id: user.startRequest })).session;
    if (index === 0) {
      while (session.phase !== "completed") session = session.phase === "setup" ? await answer(user, session) : await advance(user, session);
    } else session = await answer(user, session);
    users.push({ ...user, session });
  }
  assert.equal(users[0].session.phase, "completed");
  assert.equal(users[1].session.phase, "review");
  return users;
}

export function snapshotExistingRecords(target) {
  const queries = {
    accounts: "select jsonb_build_object('id',id,'email',email,'confirmed',email_confirmed_at,'created',created_at) as value from auth.users",
    profiles: "select to_jsonb(t) as value from public.profiles t",
    scenarios: "select jsonb_build_object('id',id,'title',title,'topic',topic,'sort_order',sort_order,'current_version',current_version,'is_demo',is_demo,'is_published',is_published) as value from public.scenarios",
    versions: "select to_jsonb(t) as value from public.scenario_versions t",
    keys: "select to_jsonb(t) as value from private.scenario_answer_keys t",
    sessions: "select to_jsonb(t) - 'target_kind' - 'target_scenario_id' - 'target_title' as value from public.training_sessions t",
    items: "select to_jsonb(t) as value from public.training_session_items t",
    attempts: "select to_jsonb(t) as value from public.attempts t",
    commands: "select to_jsonb(t) as value from private.session_commands t",
  };
  return Object.fromEntries(Object.entries(queries).map(([key, query]) => [key,
    JSON.parse(sql(target, `select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from (${query}) rows;`)),
  ]));
}

export async function assertPreservedRecords(target, before, users, env) {
  assert.deepEqual(snapshotExistingRecords(target), before, "Upgrade preserves existing accounts, roles, frozen content and all session records");
  for (const user of users) {
    user.client = client(env);
    assert.equal((await user.client.auth.signInWithPassword({ email: user.email, password: user.password })).error, null, "Existing password still signs in");
    const snapshot = await rpc(user, "get_training_session", { p_session_id: user.session.id });
    assert.deepEqual(snapshot.target, { kind: "demo" });
    assert.ok(typeof snapshot.title === "string" && snapshot.title.length > 0);
    const { target: selection, title, ...original } = snapshot;
    assert.deepEqual(original, user.session, "Existing session checkpoint and immutable feedback remain identical");
    const replay = await rpc(user, "start_training_session", { p_request_id: user.startRequest });
    assert.equal(replay.replayed, true);
    assert.equal(replay.session.id, user.session.id, "Old receipt retains its original session");
    assert.equal(replay.session.phase, user.session.phase);
  }
  const advanced = await advance(users[1], users[1].session);
  assert.equal(advanced.phase, "setup");
  assert.equal(advanced.currentIndex, 1);
  assert.equal((await users[0].client.from("profiles").select("role").single()).data.role, "creator");
}

export async function runMigrationPreservation(env = process.env) {
  const target = assertDisposableTarget(env);
  const users = await createM3Baseline(target, env);
  const snapshot = snapshotExistingRecords(target);
  await applyPendingMigrations(target, { through: LAST_M4_MIGRATION });
  await assertPreservedRecords(target, snapshot, users, env);
  console.log("Migration preservation passed: existing login, creator role, active/completed sessions, answers, versions and old command receipts survived.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMigrationPreservation();
}
