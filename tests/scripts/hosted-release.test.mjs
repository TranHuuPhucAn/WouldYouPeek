import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_ROOT } from "../../scripts/hosted-target.mjs";
import { parseReleaseCommand, migrationManifest, verifyReleaseCommit, runPreflight, requireRecentBackup, applyMigrations, seedFreshHostedProject, smokeHostedApplication } from "../../scripts/hosted-release.mjs";

const sha = "a".repeat(40), project = "b".repeat(20), production = "c".repeat(20);
const target = () => ({ schemaVersion: 1, environment: "preview", projectRef: project, productionProjectRef: production, appOrigin: "https://staging.example.com", database: { host: `db.${project}.supabase.co`, user: "postgres", port: 5432, name: "postgres" } });
const env = { WYP_HOSTED_DB_PASSWORD: "synthetic-db-secret", WYP_HOSTED_ACCESS_TOKEN: "synthetic-api-secret" };
const digest = (value) => createHash("sha256").update(value).digest("hex");
function temporary(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "wyp-hosted-release-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  mkdirSync(join(root, "supabase/maintenance"));
  writeFileSync(join(root, "supabase/migrations/20261123000100_one.sql"), "select 1;\n");
  writeFileSync(join(root, "supabase/migrations/20261123000200_two.sql"), "select 2;\n");
  writeFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "select 'readiness';\n");
  return { directory, root };
}
function gitResult(command, args) {
  assert.equal(command, "git");
  if (args[0] === "rev-parse") return sha + "\n";
  if (args[0] === "status") return "";
  throw new Error("Unexpected Git call");
}
const passed = (patch = {}) => ({ id: 100, run_number: 1, run_attempt: 1, head_sha: sha, head_branch: "main", event: "push", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", ...patch });
function github(runs, head = sha) {
  return async (url, options) => {
    assert.ok(url.startsWith("https://api.github.com/repos/TranHuuPhucAn/WouldYouPeek/"));
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => url.includes("commits/") ? { sha: head } : { workflow_runs: runs } };
  };
}

test("release CLI rejects unreviewed SHAs, reset commands and unconfirmed mutations", () => {
  const base = ["--target", "/private/target.json", "--project", project, "--environment", "preview", "--sha", sha];
  assert.equal(parseReleaseCommand(["preflight", ...base]).sha, sha);
  assert.equal(parseReleaseCommand(["migrate", ...base, "--confirm", project]).command, "migrate");
  for (const args of [["reset", ...base], ["migrate", ...base], ["seed", ...base, "--confirm", production], ["preflight", ...base.slice(0, -1), "short"], ["smoke", ...base, "--sha", sha]]) assert.throws(() => parseReleaseCommand(args));
});

test("release verification requires clean exact HEAD and the remote branch's successful push CI", async () => {
  await verifyReleaseCommit(sha, { run: gitResult, fetcher: github([passed()]) });
  for (const patch of [{ head_sha: "d".repeat(40) }, { head_branch: "dev" }, { event: "pull_request" }, { path: ".github/workflows/other.yml" }, { status: "in_progress" }, { conclusion: "failure" }])
    await assert.rejects(verifyReleaseCommit(sha, { run: gitResult, fetcher: github([passed(patch)]) }), /exact-SHA/);
  await assert.rejects(verifyReleaseCommit(sha, { run: gitResult, fetcher: github([passed()], "d".repeat(40)) }), /release branch/);
  await assert.rejects(verifyReleaseCommit(sha, { run: (_c, args) => args[0] === "status" ? " M README.md\n" : sha, fetcher: github([passed()]) }), /clean checkout/);
  await assert.rejects(verifyReleaseCommit(sha, { run: () => "d".repeat(40), fetcher: github([passed()]) }), /clean checkout/);
  await assert.rejects(verifyReleaseCommit(sha, { run: gitResult, fetcher: async () => ({ ok: false }) }), /gate stays closed/);
  await assert.rejects(verifyReleaseCommit(sha, { run: gitResult, branch: "feat/unreviewed", fetcher: github([passed()]) }), /dev or main/);
});

test("an older successful CI run cannot override the latest failed or pending run", async () => {
  for (const patch of [{ conclusion: "failure" }, { status: "in_progress", conclusion: null }]) {
    await assert.rejects(verifyReleaseCommit(sha, { run: gitResult, fetcher: github([passed({ id: 102, run_number: 2, ...patch }), passed()]) }), /Verify|CI|exact-SHA/);
  }
});

test("dev verification is used for preview and main for production", async (t) => {
  const { root } = temporary(t);
  const observed = [];
  for (const environment of ["preview", "production"]) {
    await runPreflight({ ...target(), environment }, sha, { root, verify: async (_sha, args) => observed.push(args.branch), state: () => ({ versions: [], objects: 0, accounts: 0 }) });
  }
  assert.deepEqual(observed, ["dev", "main"]);
});

test("preflight accepts only an ordered prefix of reviewed migrations and empty uploaded storage", async (t) => {
  const { root } = temporary(t), manifest = migrationManifest(root);
  const options = { root, verify: async () => {}, state: () => ({ versions: [manifest[0].version], objects: 0, accounts: 0 }) };
  const result = await runPreflight(target(), sha, options);
  assert.deepEqual(result.pending, [manifest[1]]);
  assert.equal(result.migrations[0].sha256, digest("select 1;\n"));
  for (const state of [
    { versions: [manifest[1].version], objects: 0, accounts: 0 },
    { versions: [...manifest.map((row) => row.version), "20990101000000"], objects: 0, accounts: 0 },
    { versions: [manifest[0].version], objects: 1, accounts: 0 },
  ]) await assert.rejects(runPreflight(target(), sha, { ...options, state: () => state }));
});

function backupFixture(t, patch = {}) {
  const { directory, root } = temporary(t), folder = join(directory, "backup");
  mkdirSync(folder, { mode: 0o700 });
  const encrypted = "-----BEGIN AGE ENCRYPTED FILE-----\nsynthetic-test-archive\n-----END AGE ENCRYPTED FILE-----\n";
  const files = ["roles.sql.age", "schema.sql.age", "managed-schema.sql.age", "data.sql.age"].map((name) => {
    writeFileSync(join(folder, name), encrypted, { mode: 0o600 });
    return { name, sha256: digest(encrypted) };
  });
  const now = Date.parse("2026-11-23T00:00:00Z");
  const migrations = migrationManifest(root);
  const tables = [{ schema: "auth", table: "users", columns: ["id"], rows: 0, sha256: digest("") }, { schema: "private", table: "deployment_settings", columns: ["source_mode"], rows: 1, sha256: digest("youtube-only") }, { schema: "public", table: "scenarios", columns: ["id"], rows: 0, sha256: digest("") }];
  const manifest = { schemaVersion: 1, projectRef: project, sha, createdAt: new Date(now).toISOString(), migrations, tables, files, ...patch };
  const path = join(folder, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest), { mode: 0o600 });
  return { path, folder, root, now, manifest, state: { versions: migrations.map((row) => row.version) } };
}

test("populated migrations require a fresh target-bound complete encrypted backup", (t) => {
  const fixture = backupFixture(t), options = { root: fixture.root, now: fixture.now };
  requireRecentBackup(fixture.path, target(), fixture.state, options);
  assert.throws(() => requireRecentBackup(undefined, target(), fixture.state, options), /backup/i);
  assert.throws(() => requireRecentBackup(fixture.path, { ...target(), projectRef: production }, fixture.state, options));
  assert.throws(() => requireRecentBackup(fixture.path, target(), { versions: [] }, options));
  assert.throws(() => requireRecentBackup(fixture.path, target(), fixture.state, { ...options, now: fixture.now + 24 * 60 * 60_000 + 1 }));
  assert.throws(() => requireRecentBackup(fixture.path, target(), fixture.state, { ...options, now: fixture.now - 1 }));
  chmodSync(fixture.path, 0o644);
  assert.throws(() => requireRecentBackup(fixture.path, target(), fixture.state, options), /private/);
});

test("missing or altered archive members cannot pass the backup gate", (t) => {
  const fixture = backupFixture(t), options = { root: fixture.root, now: fixture.now };
  writeFileSync(fixture.path, JSON.stringify({ ...fixture.manifest, files: fixture.manifest.files.slice(0, 3) }));
  assert.throws(() => requireRecentBackup(fixture.path, target(), fixture.state, options), /incomplete|backup/i);
  writeFileSync(fixture.path, JSON.stringify(fixture.manifest));
  writeFileSync(join(fixture.folder, "data.sql.age"), "corrupt");
  assert.throws(() => requireRecentBackup(fixture.path, target(), fixture.state, options), /integrity|Encrypted/i);
});

test("migration failure gates prevent CLI execution; approved calls bind the remote ref and protect credentials", async () => {
  let calls = 0;
  const pending = [{ version: "20261123000100" }];
  const result = { pending, database: { accounts: 1, versions: [] } };
  const run = (_command, args, options) => {
    calls++;
    assert.ok(args.includes(`--remote=${project}`));
    assert.doesNotMatch(JSON.stringify(args), /synthetic-db-secret|synthetic-api-secret/);
    assert.equal(options.env.PGSSLMODE, "verify-full");
    return "";
  };
  await assert.rejects(applyMigrations(target(), sha, { env, preflight: async () => result, run }), /backup/i);
  assert.equal(calls, 0);
  await assert.rejects(applyMigrations(target(), sha, { env: {}, preflight: async () => ({ ...result, database: { accounts: 0, versions: [] } }), run }), /ACCESS_TOKEN/);
  assert.equal(calls, 0);
  let preflights = 0;
  await applyMigrations(target(), sha, { env, run, preflight: async () => ({ pending: preflights++ ? [] : pending, database: { accounts: 0, versions: [] } }) });
  assert.equal(calls, 1);
  assert.equal(preflights, 2);
  await applyMigrations(target(), sha, { env: {}, run, preflight: async () => ({ pending: [], database: { accounts: 1, versions: [] } }) });
  assert.equal(calls, 1);
});

test("fresh seeding keeps account/storage/population guards and writes in one transaction", async () => {
  const statements = [];
  await seedFreshHostedProject(target(), sha, { root: PROJECT_ROOT, preflight: async () => ({ pending: [], database: { accounts: 0, versions: [] } }), sql: (_target, statement) => { statements.push(statement); return ""; } });
  assert.ok(statements[0].indexOf("pg_advisory_xact_lock") < statements[0].indexOf("insert into"));
  assert.match(statements[0], /exists\(select 1 from auth.users\)/);
  assert.match(statements[0], /exists\(select 1 from storage.objects\)/);
  assert.match(statements[0], /exists\(select 1 from public.scenarios\)/);
  assert.match(statements[0], /commit;/);
  assert.ok(statements[0].includes("bind-clove-utility-window"));
  assert.equal(statements.length, 2);
  const noWrites = [];
  await assert.rejects(seedFreshHostedProject(target(), sha, { preflight: async () => ({ pending: [{}] }), sql: () => noWrites.push(1) }), /migrations/);
  assert.deepEqual(noWrites, []);
});

test("read-only smoke checks use bounded GETs and expose no response data", async () => {
  const paths = [];
  const result = await smokeHostedApplication(target(), { fetcher: async (url, options) => {
    paths.push(url.pathname);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    assert.equal(options.method, undefined);
    return new Response(url.pathname === "/api/health" ? JSON.stringify({ ok: true, private: "synthetic-sensitive-value" }) : "<html>synthetic-sensitive-value</html>", { status: 200 });
  } });
  assert.ok(paths.includes("/api/health"));
  assert.ok(paths.includes("/privacy"));
  assert.equal(result.readOnlySmoke, "passed");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-sensitive-value/);
  await assert.rejects(smokeHostedApplication(target(), { fetcher: async () => new Response("private", { status: 500 }) }), /read-only smoke/);
  await assert.rejects(smokeHostedApplication(target(), { fetcher: async () => new Response(JSON.stringify({ ok: false }), { status: 200 }) }), /readiness/);
});

test("current migration head must also satisfy hosted capabilities and database assertions", async (t) => {
  const { root } = temporary(t), versions = migrationManifest(root).map((row) => row.version), statements = [];
  const options = { root, verify: async () => {}, state: () => ({ versions, scenarios: 3, accounts: 0, objects: 0 }), sql: (_target, statement) => { statements.push(statement); return statement.includes("get_application_capabilities") ? JSON.stringify({ sourceMode: "youtube-only" }) : ""; } };
  await runPreflight(target(), sha, options);
  assert.equal(statements.length, 2);
  assert.match(statements[1], /readiness/);
  await assert.rejects(runPreflight(target(), sha, { ...options, sql: () => JSON.stringify({ sourceMode: "youtube-and-upload" }) }), /YouTube only/);
  await assert.rejects(runPreflight(target(), sha, { ...options, sql: (_target, statement) => { if (statement.includes("get_application_capabilities")) return JSON.stringify({ sourceMode: "youtube-only" }); throw new Error("Database invariant failed"); } }), /invariant/);
});

test("repeating the exact initial seed verifies rather than overwriting existing content", async () => {
  const statements = [];
  const result = await seedFreshHostedProject(target(), sha, { preflight: async () => ({ pending: [], database: { accounts: 0, scenarios: 3 } }), sql: (_target, statement) => { statements.push(statement); return ""; } });
  assert.equal(result.seeded, false);
  assert.equal(result.alreadyVerified, true);
  assert.equal(statements.length, 1);
  assert.doesNotMatch(statements[0], /insert into public.scenarios/);
  for (const database of [{ accounts: 1, scenarios: 3 }, { accounts: 0, scenarios: 4 }]) {
    await assert.rejects(seedFreshHostedProject(target(), sha, { preflight: async () => ({ pending: [], database }), sql: () => assert.fail("Cannot write populated content") }));
  }
});
