import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PROJECT_ROOT, REPOSITORY, SHA, readHostedTarget, safeTargetSummary, hostedEnvironment, runHostedSql, runProtected, parseHostedArguments } from "./hosted-target.mjs";
import { readFixtures, renderSeedSql } from "./render-demo-seed.mjs";
import { validateBackupManifest } from "./hosted-backup.mjs";

export function parseReleaseCommand(args) {
  const options = parseHostedArguments(args, ["preflight", "migrate", "seed", "smoke"], ["sha", "confirm", "backup"]);
  if (!SHA.test(options.sha ?? "")) throw new Error("Specify the full reviewed commit SHA.");
  if (["migrate", "seed"].includes(options.command) && options.confirm !== options.project) throw new Error("Mutation requires --confirm with the exact project reference.");
  return options;
}

export function migrationManifest(root = PROJECT_ROOT) {
  return readdirSync(join(root, "supabase/migrations")).sort().map((name) => {
    if (!/^\d{14}_[\w-]+\.sql$/.test(name)) throw new Error("Unexpected migration filename.");
    return { version: name.slice(0, 14), name, sha256: createHash("sha256").update(readFileSync(join(root, "supabase/migrations", name))).digest("hex") };
  });
}

export async function verifyReleaseCommit(sha, { root = PROJECT_ROOT, run = runProtected, fetcher = fetch, branch = "main" } = {}) {
  if (!SHA.test(sha)) throw new Error("Invalid release SHA.");
  if (!["dev", "main"].includes(branch)) throw new Error("Only reviewed dev or main commits can be released.");
  if (run("git", ["rev-parse", "HEAD"], { cwd: root }).trim() !== sha
    || run("git", ["status", "--porcelain"], { cwd: root }).trim()) throw new Error("Release requires a clean checkout of the reviewed SHA.");
  const read = async (path) => {
    const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/${path}`, { headers: { Accept: "application/vnd.github+json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Cannot verify the release against GitHub; release gate stays closed.");
    return response.json();
  };
  const head = await read(`commits/${branch}`);
  const runs = await read(`actions/workflows/ci.yml/runs?head_sha=${sha}&branch=${branch}&event=push&per_page=100`);
  const matching = Array.isArray(runs.workflow_runs) ? runs.workflow_runs.filter((run) => run.head_sha === sha && run.head_branch === branch
    && run.event === "push" && run.path === ".github/workflows/ci.yml").sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt) : [];
  if (head.sha !== sha || matching[0]?.status !== "completed" || matching[0]?.conclusion !== "success") {
    throw new Error("Current release branch must equal the reviewed SHA and have a successful exact-SHA Verify push run.");
  }
}

export function readDatabaseState(target, options = {}) {
  const sql = `select json_build_object('history',to_regclass('supabase_migrations.schema_migrations') is not null,'application',to_regclass('public.scenarios') is not null,'applicationObjects',((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private'))+(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private'))+(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private'))),'accounts',(select count(*) from auth.users),'objects',(select count(*) from storage.objects));`;
  const state = JSON.parse(runHostedSql(target, sql, options));
  state.versions = state.history ? JSON.parse(runHostedSql(target, "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;", options)) : [];
  state.scenarios = state.application ? Number(runHostedSql(target, "select count(*) from public.scenarios;", options)) : 0;
  return state;
}

export async function runPreflight(target, sha, { root = PROJECT_ROOT, verify = verifyReleaseCommit, state = readDatabaseState, sql = runHostedSql, ...options } = {}) {
  await verify(sha, { root, branch: target.environment === "production" ? "main" : "dev" });
  const migrations = migrationManifest(root), database = state(target, { root, ...options });
  if (!Array.isArray(database.versions) || database.versions.some((version, index) => migrations[index]?.version !== version)) throw new Error("Remote migration history diverges from the reviewed ordered migrations.");
  if (database.objects !== 0) throw new Error("Hosted release requires empty uploaded-object storage.");
  if (database.versions.length === migrations.length) {
    if (JSON.parse(sql(target, "select public.get_application_capabilities();", { root, ...options })).sourceMode !== "youtube-only") throw new Error("Hosted source capability must be YouTube only.");
    if (database.scenarios > 0) sql(target, readFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "utf8"), { root, ...options });
  }
  return { ...safeTargetSummary(target), sha, migrations, pending: migrations.slice(database.versions.length), database };
}

export function requireRecentBackup(path, target, state, { now = Date.now(), root = PROJECT_ROOT } = {}) {
  if (!path) throw new Error("A verified fresh encrypted backup is required before a populated migration.");
  const manifest = validateBackupManifest(path, { root, target, now, maxAgeMs: 24 * 60 * 60_000 });
  if (JSON.stringify(manifest.migrations.map((row) => row.version)) !== JSON.stringify(state.versions)) throw new Error("Backup migration state does not match the target.");
  return manifest;
}

export async function applyMigrations(target, sha, { root = PROJECT_ROOT, env = process.env, backup, preflight = runPreflight, run = runProtected } = {}) {
  const result = await preflight(target, sha, { root, env });
  if (!result.pending.length) return result;
  if (result.database.accounts > 0) requireRecentBackup(backup, target, result.database, { root });
  if (!env.WYP_HOSTED_ACCESS_TOKEN) throw new Error("An explicitly supplied scoped WYP_HOSTED_ACCESS_TOKEN is required.");
  // CLI 3.2 uses the explicit reference and a temporary login role. No password/URL in argv.
  run(join(root, "node_modules/.bin/supabase"), ["migration", "up", `--remote=${target.projectRef}`, "--yes"], { cwd: root, env: hostedEnvironment(target, env) });
  return preflight(target, sha, { root, env });
}

export async function seedFreshHostedProject(target, sha, { root = PROJECT_ROOT, preflight = runPreflight, sql = runHostedSql, ...options } = {}) {
  const result = await preflight(target, sha, { root, ...options });
  if (result.pending.length) throw new Error("Apply the reviewed migrations before seeding.");
  if (result.database.accounts !== 0) throw new Error("Hosted initial seed cannot run after accounts exist.");
  if (result.database.scenarios > 0) {
    if (result.database.scenarios !== 3) throw new Error("Existing content is not a fresh editorial seed.");
    sql(target, readFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "utf8"), { root, ...options });
    return { ...safeTargetSummary(target), seeded: false, alreadyVerified: true };
  }
  const seed = renderSeedSql(await readFixtures(pathToFileURL(join(root, "supabase/fixtures/demo-scenarios.json"))));
  // All checks and writes share one transaction. Existing seeds are verified, never overwritten.
  const guard = `begin; select pg_advisory_xact_lock(7301026);
do $fresh$ begin
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) then raise exception 'Hosted seed requires fresh accounts and storage'; end if;
 if exists(select 1 from public.scenarios) or exists(select 1 from public.playlists) then raise exception 'Already populated; use read-only preflight instead of reseeding'; end if;
end $fresh$;`;
  sql(target, seed.replace("begin;", guard), { root, ...options });
  sql(target, readFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "utf8"), { root, ...options });
  return { ...safeTargetSummary(target), seeded: true };
}

export async function smokeHostedApplication(target, { fetcher = fetch } = {}) {
  for (const path of ["/api/health", "/", "/library", "/library/playlists", "/help", "/privacy"]) {
    const response = await fetcher(new URL(path, target.appOrigin), { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Hosted read-only smoke failed at ${path}.`);
    if (path === "/api/health" && (await response.json()).ok !== true) throw new Error("Hosted readiness failed.");
    if (!response.bodyUsed) await response.body?.cancel();
  }
  return { ...safeTargetSummary(target), readOnlySmoke: "passed", authAndPlayback: "require final-origin acceptance" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReleaseCommand(process.argv.slice(2));
    const target = readHostedTarget(options.target, options.project, options.environment);
    const result = options.command === "migrate" ? await applyMigrations(target, options.sha, { backup: options.backup })
      : options.command === "seed" ? await seedFreshHostedProject(target, options.sha)
      : options.command === "smoke" ? (await verifyReleaseCommit(options.sha, { branch: target.environment === "production" ? "main" : "dev" }), await smokeHostedApplication(target))
      : await runPreflight(target, options.sha);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error instanceof SyntaxError ? "Invalid protected release configuration." : error.message); process.exitCode = 1; }
}
