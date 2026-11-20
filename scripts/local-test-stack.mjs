import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync, openSync, closeSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanChildEnvironment, localUrl, OWNER_FILE, readDisposableWorkspace, TEST_PORTS, TEST_APP_ORIGIN, testProjectId } from "./local-target.mjs";

const sourceDefault = fileURLToPath(new URL("../", import.meta.url));
export const LAST_M3_MIGRATION = "20261117000500";
export const LAST_M4_MIGRATION = "20261118000400";
export const LAST_M5_MIGRATION = "20261120000300";
const sourceEntries = ["src", "tests", "scripts", "public", "supabase", "docs", "README.md",
  "package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "vitest.config.ts", ".env.example"];

function testConfig(original, projectId) {
  return original.replace(/^project_id\s*=.*$/m, `project_id = ${JSON.stringify(projectId)}`)
    .replace(/\b5432([0-6])\b/g, "5532$1").replace(/:3000\b/g, ":3100")
    .replace(/^site_url\s*=.*$/m, `site_url = ${JSON.stringify(TEST_APP_ORIGIN)}`)
    .replace(/(\[studio\]\s*\nenabled\s*=\s*)true/, "$1false");
}

export function copyProjectSources(sourceRoot, workspace) {
  for (const name of sourceEntries) {
    const source = join(sourceRoot, name);
    if (!existsSync(source)) continue;
    cpSync(source, join(workspace, name), { recursive: true, filter(path) {
      const parts = relative(sourceRoot, path).split(/[\\/]/);
      if (parts.some((part) => [".git", "node_modules", ".next", ".temp", ".branches", ".wyp-test-work"].includes(part))) return false;
      if (basename(path).startsWith(".env") && basename(path) !== ".env.example") return false;
      if (lstatSync(path).isSymbolicLink()) throw new Error("Source snapshots cannot include symlinks.");
      return true;
    } });
  }
  const evidence = join(sourceRoot, "artifacts/vod-review");
  if (existsSync(evidence)) for (const name of readdirSync(evidence)) {
    if (!/^scenario-[\w.-]+\.jpg$/.test(name)) continue;
    const destination = join(workspace, "artifacts/vod-review", name);
    mkdirSync(join(workspace, "artifacts/vod-review"), { recursive: true });
    cpSync(join(evidence, name), destination);
  }
}

export function prepareTestWorkspace(source = sourceDefault, { baseline = true } = {}) {
  const sourceRoot = realpathSync(source);
  const runId = randomUUID();
  const parent = join(sourceRoot, ".wyp-test-work");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (realpathSync(parent) !== parent) throw new Error("Disposable parent cannot be a symlink.");
  const workspace = join(parent, runId), projectId = testProjectId(runId);
  mkdirSync(workspace, { mode: 0o700 });
  copyProjectSources(sourceRoot, workspace);
  writeFileSync(join(workspace, "supabase/config.toml"), testConfig(readFileSync(join(sourceRoot, "supabase/config.toml"), "utf8"), projectId));
  writeFileSync(join(workspace, OWNER_FILE), JSON.stringify({ schemaVersion: 1, sourceRoot, workspace, projectId, runId }), { mode: 0o600, flag: "wx" });
  const target = readDisposableWorkspace(workspace);
  if (baseline) stagePendingMigrations(target);
  return target;
}

export function refreshTestSources(target, { baseline = false } = {}) {
  const owned = readDisposableWorkspace(target.workspace);
  // Reconcile source-owned entries without removing CLI state or installed dependencies.
  for (const name of sourceEntries) {
    if (name === "supabase") {
      for (const entry of readdirSync(join(owned.workspace, name))) {
        if (![".temp", ".branches"].includes(entry)) rmSync(join(owned.workspace, name, entry), { recursive: true, force: true });
      }
    } else rmSync(join(owned.workspace, name), { recursive: true, force: true });
  }
  rmSync(join(owned.workspace, "artifacts/vod-review"), { recursive: true, force: true });
  rmSync(join(owned.workspace, ".wyp-pending-migrations"), { recursive: true, force: true });
  copyProjectSources(owned.sourceRoot, owned.workspace);
  writeFileSync(join(owned.workspace, "supabase/config.toml"), testConfig(readFileSync(join(owned.sourceRoot, "supabase/config.toml"), "utf8"), owned.projectId));
  if (baseline) stagePendingMigrations(owned);
  return readDisposableWorkspace(owned.workspace);
}

export function stagePendingMigrations(target) {
  const owned = readDisposableWorkspace(target.workspace);
  const directory = join(owned.workspace, "supabase/migrations"), pending = join(owned.workspace, ".wyp-pending-migrations");
  mkdirSync(pending, { recursive: true });
  for (const name of readdirSync(directory)) {
    if (/^\d{14}_[\w-]+\.sql$/.test(name) && name.slice(0, 14) > LAST_M3_MIGRATION) renameSync(join(directory, name), join(pending, name));
  }
}

export async function runTestCommand(command, args, { cwd, env = cleanChildEnvironment(), capture = false, input, signal } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolvePromise, reject) => {
    const grouped = Boolean(signal) && process.platform !== "win32";
    const child = spawn(command, args, { cwd, env, detached: grouped, stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", "inherit"] });
    let killTimer;
    const kill = (kind) => {
      try { if (grouped && child.pid) process.kill(-child.pid, kind); else child.kill(kind); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    };
    const abort = () => {
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 5000);
      killTimer.unref();
    };
    signal?.addEventListener("abort", abort, { once: true });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.length > 20 * 1024 * 1024) child.kill("SIGTERM");
    });
    if (input !== undefined) child.stdin.end(input);
    child.on("error", () => reject(new Error(`Could not start ${basename(command)}.`)));
    child.on("close", (code, exitSignal) => {
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolvePromise(output);
      else reject(new Error(`${basename(command)} ${args[0] ?? ""} failed (${exitSignal ?? code}).`));
    });
  });
}

export async function runCli(target, args, { capture = true, signal } = {}) {
  const owned = readDisposableWorkspace(target.workspace);
  const localBinary = join(owned.workspace, "node_modules/.bin/supabase");
  const binary = existsSync(localBinary) ? localBinary : join(owned.sourceRoot, "node_modules/.bin/supabase");
  if (args.some((arg) => /^(--remote|--all|--workdir|--project-id)(=|$)/.test(arg))) throw new Error("Test commands cannot override their target.");
  return runTestCommand(binary, args, { cwd: owned.workspace, capture, signal });
}

export async function assertPortsFree() {
  for (const port of Object.values(TEST_PORTS)) await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Test port ${port} is occupied. No existing service was stopped.`)));
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolvePromise()));
  });
}

export function assertDockerOwnership(target, execute = execFileSync, { allowMissing = false } = {}) {
  const owned = readDisposableWorkspace(target.workspace);
  const ids = execute("docker", ["ps", "-aq", "--filter", `label=com.supabase.cli.project=${owned.projectId}`], { encoding: "utf8", env: cleanChildEnvironment() }).trim().split(/\s+/).filter(Boolean);
  if (!ids.length && !allowMissing) throw new Error("Disposable Docker services are missing; refusing to assume a target.");
  for (const id of ids) {
    const labels = JSON.parse(execute("docker", ["inspect", id, "--format", "{{json .Config.Labels}}"], { encoding: "utf8", env: cleanChildEnvironment() }));
    if (labels["com.supabase.cli.project"] !== owned.projectId || labels["com.supabase.cli.workdir"] !== owned.workspace) throw new Error("Docker resource ownership does not match this test run.");
  }
  return owned;
}

export async function startTestStack(target, { signal } = {}) {
  readDisposableWorkspace(target.workspace);
  await assertPortsFree();
  await runCli(target, ["start"], { signal });
  assertDockerOwnership(target);
  console.log(`[verify] Disposable database ready: ${target.projectId}`);
}

export async function readTestEnvironment(target) {
  const owned = assertDockerOwnership(target);
  const status = JSON.parse(await runCli(owned, ["status", "-o", "json"]));
  const api = localUrl(status.API_URL, TEST_PORTS.api);
  const mail = localUrl(status.MAILPIT_URL || status.INBUCKET_URL, TEST_PORTS.mail);
  const key = status.PUBLISHABLE_KEY || status.ANON_KEY;
  if (!key || !status.SERVICE_ROLE_KEY) throw new Error("Disposable credentials are unavailable.");
  const app = TEST_APP_ORIGIN;
  return {
    ...cleanChildEnvironment(), WYP_TEST_WORKSPACE: owned.workspace, WYP_TEST_RUN_ID: owned.runId,
    WYP_TEST_PROJECT_ID: owned.projectId, SUPABASE_TEST_URL: api, SUPABASE_TEST_MAIL_URL: mail,
    SUPABASE_TEST_APP_URL: app, SUPABASE_TEST_PUBLISHABLE_KEY: key, SUPABASE_TEST_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: api, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key, NEXT_PUBLIC_APP_URL: app,
  };
}

export function applicationEnvironment(testEnv) {
  return { ...cleanChildEnvironment(testEnv), NEXT_PUBLIC_SUPABASE_URL: testEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: testEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: testEnv.NEXT_PUBLIC_APP_URL };
}

export async function applyPendingMigrations(target, { through, cli = runCli } = {}) {
  const owned = readDisposableWorkspace(target.workspace);
  if (through !== undefined && !/^\d{14}$/.test(through)) throw new Error("Invalid migration boundary.");
  const pending = join(owned.workspace, ".wyp-pending-migrations");
  if (existsSync(pending)) for (const name of readdirSync(pending)) {
    if (!/^\d{14}_[\w-]+\.sql$/.test(name)) throw new Error("Unexpected pending migration file.");
    if (through !== undefined && name.slice(0, 14) > through) continue;
    renameSync(join(pending, name), join(owned.workspace, "supabase/migrations", name));
  }
  await cli(owned, ["migration", "up"]);
}

export async function stopTestStack(target) {
  const owned = assertDockerOwnership(target, execFileSync, { allowMissing: true });
  const localBinary = join(owned.workspace, "node_modules/.bin/supabase");
  const binary = existsSync(localBinary) ? localBinary : join(owned.sourceRoot, "node_modules/.bin/supabase");
  await runTestCommand(binary, ["stop", "--project-id", owned.projectId, "--no-backup"], { cwd: owned.workspace, capture: true });
  console.log("[verify] Removed only this run's disposable Supabase services and volumes.");
}

export function cleanupTestWorkspace(target) {
  const owned = readDisposableWorkspace(target.workspace);
  rmSync(owned.workspace, { recursive: true, force: false });
}

export async function startTestApp(target, env, { signal } = {}) {
  signal?.throwIfAborted();
  const logPath = join(target.workspace, ".wyp-server.log"), fd = openSync(logPath, "a", 0o600);
  const app = spawn(process.execPath, [join(target.workspace, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(TEST_PORTS.app)],
    { cwd: target.workspace, env: applicationEnvironment(env), stdio: ["ignore", fd, fd] });
  closeSync(fd);
  let failed = false;
  app.once("error", () => { failed = true; });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (failed || app.exitCode !== null) throw new Error("The disposable production app exited before readiness.");
      try {
        const response = await fetch(`${env.SUPABASE_TEST_APP_URL}/api/challenges`, { signal: AbortSignal.timeout(1500) });
        if (response.ok && (await response.json()).challenges?.length === 3) return app;
      } catch { /* App is still starting. */ }
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error("The disposable production app did not become ready.");
  } catch (error) { await stopTestApp(app); throw error; }
}

export async function stopTestApp(app) {
  if (!app || app.exitCode !== null || app.signalCode !== null) return;
  const exited = new Promise((done) => app.once("exit", done));
  app.kill("SIGTERM");
  const timer = setTimeout(() => { if (app.exitCode === null && app.signalCode === null) app.kill("SIGKILL"); }, 5000);
  await exited;
  clearTimeout(timer);
}

export async function startTestMediaWorker(target, env, { signal } = {}) {
  const owned = readDisposableWorkspace(target.workspace);
  const options = { cwd: owned.workspace, env, signal };
  await runTestCommand("npm", ["run", "media:setup"], options);
  await runTestCommand("npm", ["run", "media:check"], options);
  const fd = openSync(join(owned.workspace, ".wyp-media-worker.log"), "a", 0o600);
  const worker = spawn(process.execPath, [join(owned.workspace, "scripts/local-media-worker.mjs"), "worker"],
    { cwd: owned.workspace, env: applicationEnvironment(env), stdio: ["ignore", "pipe", fd] });
  closeSync(fd);
  const abort = () => worker.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await new Promise((done, fail) => {
      let output = "";
      const timer = setTimeout(() => fail(new Error("The disposable media validator did not become ready.")), 30_000);
      const cleanup = () => { clearTimeout(timer); worker.stdout.off("data", ready); worker.off("error", error); worker.off("exit", exited); };
      const error = () => { cleanup(); fail(new Error("Could not start the disposable media validator.")); };
      const exited = () => { cleanup(); fail(new Error("The disposable media validator exited before readiness.")); };
      const ready = (chunk) => {
        output = (output + chunk).slice(-4096);
        if (output.includes("[media] Validator ready")) { cleanup(); done(); }
      };
      worker.stdout.on("data", ready); worker.once("error", error); worker.once("exit", exited);
    });
    worker.stdout.resume();
    return worker;
  } catch (error) { await stopTestApp(worker); throw error; }
  finally { signal?.removeEventListener("abort", abort); }
}

function assertMediaWorkerRunning(worker) {
  if (worker && typeof worker === "object" && (worker.exitCode !== null || worker.signalCode !== null))
    throw new Error("The disposable media validator stopped unexpectedly.");
}

/** The upgrade check is a required phase before resetting the disposable database. */
export async function runVerificationPipeline(target, {
  run = runTestCommand, environment = readTestEnvironment, cli = runCli,
  startApp = startTestApp, stopApp = stopTestApp,
  startWorker = startTestMediaWorker, stopWorker = stopTestApp, signal,
} = {}) {
  const owned = readDisposableWorkspace(target.workspace);
  const env = await environment(owned);
  const options = { cwd: owned.workspace, env, signal };
  await run(process.execPath, ["--test", "tests/scripts/*.test.mjs"], options);
  console.log("[verify] Checking preservation of milestone-three accounts and sessions.");
  await run(process.execPath, ["tests/migrations/milestone-4-preservation.test.mjs"], options);
  console.log("[verify] Checking preservation of milestone-four creator drafts, reviews and published sessions.");
  await run(process.execPath, ["tests/migrations/milestone-5-preservation.test.mjs"], options);
  console.log("[verify] Checking preservation of milestone-five uploads, immutable content and saved sessions.");
  await run(process.execPath, ["tests/migrations/milestone-6-preservation.test.mjs"], options);
  // The upgrade script applies the pending migrations in this owned workspace.
  await cli(owned, ["db", "reset", "--yes"], { signal });
  await run(process.execPath, ["scripts/generate-video-fixtures.mjs"], options);
  let app, worker;
  try {
    worker = await startWorker(owned, env, { signal });
    for (const script of ["db:seed:check", "db:types:check", "test", "test:db", "test:integration", "typecheck", "build"]) {
      assertMediaWorkerRunning(worker);
      console.log(`[verify] ${script}`);
      await run("npm", ["run", script], { cwd: owned.workspace, signal, env: script === "build" ? applicationEnvironment(env) : env });
    }
    assertMediaWorkerRunning(worker);
    app = await startApp(owned, env, { signal });
    await run("npm", ["run", "test:http"], options);
    assertMediaWorkerRunning(worker);
  } finally {
    try { if (app) await stopApp(app); }
    finally { if (worker) await stopWorker(worker); }
  }
}

export async function runFullVerification(source = sourceDefault, { keep = false, signal } = {}) {
  signal?.throwIfAborted();
  const target = prepareTestWorkspace(source);
  let started = false, succeeded = false;
  try {
    console.log(`[verify] Isolated workspace: ${target.workspace}`);
    await runTestCommand("npm", ["ci", "--prefer-offline"], { cwd: target.workspace, signal });
    await assertPortsFree();
    started = true; // A failed start may still have created owned resources.
    await startTestStack(target, { signal });
    await runVerificationPipeline(target, { signal });
    succeeded = true;
    console.log("[verify] All isolated verification phases passed.");
    return target;
  } finally {
    if (!keep || signal?.aborted) {
      let stopped = !started;
      if (started) { await stopTestStack(target); stopped = true; }
      if (stopped) {
        if (!succeeded) {
          for (const name of [".wyp-server.log", ".wyp-media-worker.log"]) {
            const log = join(target.workspace, name);
            if (!existsSync(log)) continue;
            const evidence = join(target.sourceRoot, "test-results", `milestone-6-${target.runId}`);
            mkdirSync(evidence, { recursive: true });
            // These services must redact credentials; preserve only bounded diagnostics.
            writeFileSync(join(evidence, name.slice(1)), readFileSync(log, "utf8").slice(-100_000), { mode: 0o600 });
          }
        }
        cleanupTestWorkspace(target);
      }
    }
  }
}

/** Cancellation stops owned children, then allows the normal finally blocks to clean up. */
export async function withVerificationSignals(run) {
  const controller = new AbortController();
  const interrupt = (name) => controller.abort(new Error(`Verification cancelled by ${name}.`));
  const sigint = () => interrupt("SIGINT"), sigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", sigint); process.on("SIGTERM", sigterm);
  try {
    const result = await run(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    process.off("SIGINT", sigint); process.off("SIGTERM", sigterm);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("Use npm run test:ci without target overrides.");
    await withVerificationSignals((signal) => runFullVerification(sourceDefault, { signal }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
