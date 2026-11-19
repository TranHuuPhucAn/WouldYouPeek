import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, symlinkSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { prepareTestWorkspace, refreshTestSources, cleanupTestWorkspace, assertDockerOwnership, applicationEnvironment, runVerificationPipeline, applyPendingMigrations, LAST_M4_MIGRATION } from "../../scripts/local-test-stack.mjs";
import { assertDisposableTarget, readDisposableWorkspace, readLocalProject, OWNER_FILE } from "../../scripts/local-target.mjs";
import { fixtureProject, fixtureEnvironment } from "./helpers.mjs";

test("source snapshots omit credentials and build output and stage only new migrations", (t) => {
  const root = fixtureProject(t), target = prepareTestWorkspace(root);
  assert.equal(target.projectId.length, 40);
  assert.equal(existsSync(join(target.workspace, ".env.local")), false);
  assert.equal(existsSync(join(target.workspace, ".next")), false);
  assert.equal(existsSync(join(target.workspace, "supabase/migrations/20261117000500_baseline.sql")), true);
  assert.equal(existsSync(join(target.workspace, "supabase/migrations/20261118000100_new.sql")), false);
  assert.equal(existsSync(join(target.workspace, ".wyp-pending-migrations/20261118000100_new.sql")), true);
  assert.equal(readFileSync(join(root, ".next/sentinel"), "utf8"), "preserve");
  assert.match(readFileSync(join(root, ".env.local"), "utf8"), /do-not-copy/);
});

test("disposable profile proves marker, config, process identity and exact endpoints", (t) => {
  const root = fixtureProject(t), target = prepareTestWorkspace(root), env = fixtureEnvironment(target);
  assert.equal(assertDisposableTarget(env, target.workspace).projectId, target.projectId);
  for (const patch of [
    { WYP_TEST_PROJECT_ID: "would-you-peek" }, { WYP_TEST_RUN_ID: "wrong" },
    { SUPABASE_TEST_URL: "http://127.0.0.1:54321" }, { SUPABASE_TEST_URL: "https://hosted.supabase.co" },
    { SUPABASE_TEST_APP_URL: "http://127.0.0.1:3000" }, { SUPABASE_TEST_MAIL_URL: "http://127.0.0.1:54324" },
    { SUPABASE_TEST_APP_URL: "http://127.0.0.1:3100" },
  ]) assert.throws(() => assertDisposableTarget({ ...env, ...patch }, target.workspace));
  assert.throws(() => assertDisposableTarget(env, root));
  assert.throws(() => assertDisposableTarget({}, target.workspace));
});

test("refresh removes deleted sources while preserving explicit run state", (t) => {
  const root = fixtureProject(t), target = prepareTestWorkspace(root);
  mkdirSync(join(target.workspace, "supabase/.temp"));
  writeFileSync(join(target.workspace, "supabase/.temp/owned-state"), "keep");
  mkdirSync(join(target.workspace, "node_modules"));
  writeFileSync(join(target.workspace, "node_modules/sentinel"), "keep");
  renameSync(join(root, "src/example.ts"), join(root, "src/renamed.ts"));
  unlinkSync(join(root, "supabase/migrations/20261118000100_new.sql"));
  refreshTestSources(target);
  assert.equal(existsSync(join(target.workspace, "src/example.ts")), false);
  assert.equal(existsSync(join(target.workspace, "src/renamed.ts")), true);
  assert.equal(existsSync(join(target.workspace, ".wyp-pending-migrations")), false);
  assert.equal(readFileSync(join(target.workspace, "supabase/.temp/owned-state"), "utf8"), "keep");
  assert.equal(readFileSync(join(target.workspace, "node_modules/sentinel"), "utf8"), "keep");
});

for (const signal of ["SIGINT", "SIGTERM"]) test(`${signal} cancels owned commands and reaches cleanup`, { timeout: 10_000 }, async (t) => {
  const root = fixtureProject(t), marker = join(root, "cleanup-ran");
  const moduleUrl = new URL("../../scripts/local-test-stack.mjs", import.meta.url).href;
  const script = `
    import { writeFileSync } from 'node:fs';
    import { withVerificationSignals, runTestCommand } from ${JSON.stringify(moduleUrl)};
    try {
      await withVerificationSignals(async (signal) => {
        try { await runTestCommand(process.execPath, ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], { signal }); }
        finally { writeFileSync(${JSON.stringify(marker)}, 'cleaned'); }
      });
    } catch { process.exitCode = 1; }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const completed = new Promise((done) => child.once("close", (code, killedBy) => done({ code, killedBy })));
  await new Promise((done, fail) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("ready")) done(); });
    child.once("error", fail);
  });
  child.kill(signal);
  assert.deepEqual(await completed, { code: 1, killedBy: null });
  assert.equal(readFileSync(marker, "utf8"), "cleaned");
});

test("missing or tampered markers cannot become normal development projects", (t) => {
  const root = fixtureProject(t), target = prepareTestWorkspace(root), path = join(target.workspace, OWNER_FILE);
  const marker = readFileSync(path, "utf8");
  writeFileSync(path, JSON.stringify({ ...JSON.parse(marker), sourceRoot: "/tmp" }));
  assert.throws(() => cleanupTestWorkspace(target));
  assert.ok(existsSync(target.workspace));
  writeFileSync(path, marker);
  unlinkSync(path);
  assert.throws(() => readLocalProject(target.workspace), /marker/);
});

test("a symlink cannot redirect a test workspace or marker", (t) => {
  const root = fixtureProject(t), target = prepareTestWorkspace(root);
  const alias = join(root, "alias");
  symlinkSync(target.workspace, alias, "dir");
  assert.throws(() => readDisposableWorkspace(alias), /symlink/);
  const marker = join(target.workspace, OWNER_FILE), alternative = join(target.workspace, "marker-copy");
  writeFileSync(alternative, readFileSync(marker)); unlinkSync(marker); symlinkSync(alternative, marker);
  assert.throws(() => readDisposableWorkspace(target.workspace), /symlink/);
});

test("Docker ownership fails closed for absent or mismatched services", (t) => {
  const root = fixtureProject(t), target = prepareTestWorkspace(root);
  assert.throws(() => assertDockerOwnership(target, () => ""), /missing/);
  assert.throws(() => assertDockerOwnership(target, (command, args) => args[0] === "ps" ? "container-id" : JSON.stringify({ "com.supabase.cli.project": "would-you-peek", "com.supabase.cli.workdir": root })), /ownership/);
  assert.equal(assertDockerOwnership(target, (command, args) => args[0] === "ps" ? "container-id" : JSON.stringify({ "com.supabase.cli.project": target.projectId, "com.supabase.cli.workdir": target.workspace })).projectId, target.projectId);
});

test("cleanup removes only the validated owned workspace", (t) => {
  const root = fixtureProject(t), first = prepareTestWorkspace(root), second = prepareTestWorkspace(root);
  assert.throws(() => cleanupTestWorkspace({ workspace: root }));
  cleanupTestWorkspace(first);
  assert.equal(existsSync(first.workspace), false);
  assert.equal(existsSync(second.workspace), true);
  assert.equal(readFileSync(join(root, ".next/sentinel"), "utf8"), "preserve");
});

test("the app receives public configuration without test administrator credentials", (t) => {
  const target = prepareTestWorkspace(fixtureProject(t));
  const env = applicationEnvironment({ ...fixtureEnvironment(target), WYP_MEDIA_VALIDATOR_TOKEN: "worker-only" });
  assert.equal(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "test-public");
  assert.equal(env.NEXT_PUBLIC_APP_URL, "http://localhost:3100");
  assert.equal(Object.keys(env).some((key) => key.startsWith("SUPABASE_TEST_") || key.startsWith("WYP_TEST_")), false);
  assert.equal(env.WYP_MEDIA_VALIDATOR_TOKEN, undefined);
});

test("migration phases preserve the true M4 boundary before applying M5", async (t) => {
  const root = fixtureProject(t);
  const mediaMigration = "20261120000100_video_assets.sql";
  writeFileSync(join(root, "supabase/migrations", mediaMigration), "-- media\n");
  const target = prepareTestWorkspace(root), calls = [];
  const cli = async (owned, args) => { assert.equal(owned.projectId, target.projectId); calls.push(args); };
  await applyPendingMigrations(target, { through: LAST_M4_MIGRATION, cli });
  assert.equal(existsSync(join(target.workspace, "supabase/migrations/20261118000100_new.sql")), true);
  assert.equal(existsSync(join(target.workspace, "supabase/migrations", mediaMigration)), false);
  assert.equal(existsSync(join(target.workspace, ".wyp-pending-migrations", mediaMigration)), true);
  await applyPendingMigrations(target, { cli });
  assert.equal(existsSync(join(target.workspace, "supabase/migrations", mediaMigration)), true);
  assert.equal(existsSync(join(target.workspace, ".wyp-pending-migrations", mediaMigration)), false);
  assert.deepEqual(calls, [["migration", "up"], ["migration", "up"]]);
  await assert.rejects(applyPendingMigrations(target, { through: "invalid", cli }), /boundary/);
});

function pipelineFakes(target, { failOn } = {}) {
  const calls = [];
  const step = (name) => { calls.push(name); if (name === failOn) throw new Error(`failure: ${name}`); };
  return { calls, options: {
    environment: async () => fixtureEnvironment(target),
    run: async (command, args) => step(args.includes("tests/migrations/milestone-4-preservation.test.mjs") ? "upgrade"
      : args.includes("tests/migrations/milestone-5-preservation.test.mjs") ? "media-upgrade" : args[1] ?? args[0]),
    cli: async (owned, args) => { assert.equal(owned.projectId, target.projectId); step(args.join(" ")); },
    startApp: async () => { step("start-app"); return "owned-process"; },
    stopApp: async (app) => { assert.equal(app, "owned-process"); step("stop-app"); },
    startWorker: async () => { step("start-worker"); return "owned-worker"; },
    stopWorker: async (worker) => { assert.equal(worker, "owned-worker"); step("stop-worker"); },
  } };
}

test("failed upgrade cannot be hidden by a reset or a passing later build", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target, { failOn: "upgrade" });
  await assert.rejects(runVerificationPipeline(target, fake.options), /failure: upgrade/);
  assert.equal(fake.calls.includes("db reset --yes"), false);
  assert.equal(fake.calls.includes("build"), false);
});

test("full verification includes upgrade before clean install and every required suite", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target);
  await runVerificationPipeline(target, fake.options);
  assert.ok(fake.calls.indexOf("upgrade") < fake.calls.indexOf("db reset --yes"));
  assert.ok(fake.calls.indexOf("upgrade") < fake.calls.indexOf("media-upgrade"));
  assert.ok(fake.calls.indexOf("media-upgrade") < fake.calls.indexOf("db reset --yes"));
  assert.ok(fake.calls.indexOf("scripts/generate-video-fixtures.mjs") < fake.calls.indexOf("start-worker"));
  for (const phase of ["db:seed:check", "db:types:check", "test", "test:db", "test:integration", "typecheck", "build", "test:http"]) assert.ok(fake.calls.includes(phase), phase);
  assert.deepEqual(fake.calls.slice(-2), ["stop-app", "stop-worker"]);
});

test("HTTP failure propagates while stopping the exact app process", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target, { failOn: "test:http" });
  await assert.rejects(runVerificationPipeline(target, fake.options), /failure: test:http/);
  assert.deepEqual(fake.calls.slice(-2), ["stop-app", "stop-worker"]);
});

test("failed media upgrade prevents reset and worker startup", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target, { failOn: "media-upgrade" });
  await assert.rejects(runVerificationPipeline(target, fake.options), /failure: media-upgrade/);
  assert.ok(fake.calls.includes("upgrade"));
  assert.equal(fake.calls.includes("db reset --yes"), false);
  assert.equal(fake.calls.includes("start-worker"), false);
});

test("a failed integration suite stops the owned worker without starting the app", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target, { failOn: "test:integration" });
  await assert.rejects(runVerificationPipeline(target, fake.options), /failure: test:integration/);
  assert.equal(fake.calls.includes("start-app"), false);
  assert.equal(fake.calls.at(-1), "stop-worker");
});

test("an unexpectedly exited validator cannot be hidden by passing application checks", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target);
  let stopped = false;
  fake.options.startWorker = async () => ({ exitCode: 1, signalCode: null });
  fake.options.stopWorker = async () => { stopped = true; };
  await assert.rejects(runVerificationPipeline(target, fake.options), /stopped unexpectedly/);
  assert.equal(stopped, true);
  assert.equal(fake.calls.includes("build"), false);
});

test("worker cleanup still happens when stopping the app fails", async (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), fake = pipelineFakes(target, { failOn: "stop-app" });
  await assert.rejects(runVerificationPipeline(target, fake.options), /failure: stop-app/);
  assert.equal(fake.calls.at(-1), "stop-worker");
});
