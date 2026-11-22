import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export const TEST_PORTS = Object.freeze({
  api: 55321, db: 55322, shadow: 55320, studio: 55323,
  mail: 55324, smtp: 55325, pop3: 55326, app: 3100,
});
export const OWNER_FILE = ".wyp-test-owner.json";
// Cookies ignore ports. A separate hostname keeps browser QA from replacing the user's 127.0.0.1 cookies.
export const TEST_APP_ORIGIN = "http://localhost:3100";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function testProjectId(runId) {
  if (!UUID.test(runId)) throw new Error("Invalid test run identifier.");
  // CLI 3 normalizes project IDs to at most 40 characters.
  return `wyp-test-${runId.slice(0, 31)}`;
}

export function localUrl(value, port) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.port !== String(port) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`Expected a loopback service on port ${port}; other targets are refused.`);
  }
  return url.origin;
}

export function configValue(config, section, key) {
  let current = "";
  for (const line of config.split(/\r?\n/)) {
    const heading = line.trim().match(/^\[([^\]]+)\]$/);
    if (heading) { current = heading[1]; continue; }
    if (current !== section) continue;
    const field = line.match(/^\s*([a-z][a-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (field?.[1] === key) return JSON.parse(field[2]);
  }
  throw new Error(`Local configuration is missing ${section ? `${section}.` : ""}${key}.`);
}

/** A marker never authorizes cleanup outside its exact, non-symlink workspace. */
export function readDisposableWorkspace(rootPath) {
  const workspace = realpathSync(rootPath);
  if (lstatSync(resolve(rootPath)).isSymbolicLink()) throw new Error("A test workspace cannot be a symlink.");
  const markerPath = join(workspace, OWNER_FILE);
  if (lstatSync(markerPath).isSymbolicLink()) throw new Error("A test marker cannot be a symlink.");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (marker.schemaVersion !== 1 || !UUID.test(marker.runId)
    || marker.projectId !== testProjectId(marker.runId)
    || marker.workspace !== workspace || typeof marker.sourceRoot !== "string") {
    throw new Error("Invalid disposable test project identity.");
  }
  const sourceRoot = realpathSync(marker.sourceRoot);
  const expectedParent = join(sourceRoot, ".wyp-test-work");
  if (sourceRoot !== marker.sourceRoot || dirname(workspace) !== expectedParent
    || realpathSync(expectedParent) !== expectedParent
    || workspace !== join(expectedParent, marker.runId)) {
    throw new Error("Test workspace is outside its owned directory.");
  }
  const config = readFileSync(join(workspace, "supabase/config.toml"), "utf8");
  if (configValue(config, "", "project_id") !== marker.projectId) {
    throw new Error("Disposable project configuration does not match its marker.");
  }
  for (const [section, key, port] of [
    ["api", "port", TEST_PORTS.api], ["db", "port", TEST_PORTS.db],
    ["db", "shadow_port", TEST_PORTS.shadow], ["studio", "port", TEST_PORTS.studio],
    ["local_smtp", "port", TEST_PORTS.mail], ["local_smtp", "smtp_port", TEST_PORTS.smtp],
    ["local_smtp", "pop3_port", TEST_PORTS.pop3],
  ]) {
    if (configValue(config, section, key) !== port) throw new Error("Disposable project ports do not match its profile.");
  }
  if (configValue(config, "auth", "site_url") !== TEST_APP_ORIGIN) {
    throw new Error("Disposable authentication origin does not match its profile.");
  }
  return { ...marker, sourceRoot, workspace, ports: TEST_PORTS, disposable: true };
}

export function assertDisposableTarget(env = process.env, cwd = process.cwd()) {
  if (!env.WYP_TEST_WORKSPACE || !env.WYP_TEST_RUN_ID || !env.WYP_TEST_PROJECT_ID) {
    throw new Error("Use npm run test:ci; publication tests require an owned disposable test project.");
  }
  const target = readDisposableWorkspace(env.WYP_TEST_WORKSPACE);
  if (target.workspace !== realpathSync(cwd) || target.runId !== env.WYP_TEST_RUN_ID
    || target.projectId !== env.WYP_TEST_PROJECT_ID) {
    throw new Error("Test process identity does not match its disposable workspace.");
  }
  localUrl(env.SUPABASE_TEST_URL, TEST_PORTS.api);
  localUrl(env.SUPABASE_TEST_MAIL_URL, TEST_PORTS.mail);
  localUrl(env.SUPABASE_TEST_APP_URL, TEST_PORTS.app);
  if (env.SUPABASE_TEST_APP_URL !== TEST_APP_ORIGIN) throw new Error("Test app must use its cookie-isolated hostname.");
  return target;
}

export function readLocalProject(rootPath) {
  const root = realpathSync(rootPath);
  let hasMarker = false;
  try { lstatSync(join(root, OWNER_FILE)); hasMarker = true; } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (hasMarker) return readDisposableWorkspace(root);
  // A missing marker must never turn a former disposable workspace into a normal project.
  if (root.split(/[\\/]/).includes(".wyp-test-work")) throw new Error("Disposable marker is missing.");
  const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
  if (configValue(config, "", "project_id") !== "would-you-peek"
    || configValue(config, "api", "port") !== 54321 || configValue(config, "db", "port") !== 54322) {
    throw new Error("Expected the Would You Peek local development project.");
  }
  return { workspace: root, sourceRoot: root, projectId: "would-you-peek", disposable: false,
    ports: { api: 54321, db: 54322, mail: 54324, app: 3000 } };
}

/** Do not allow an inherited provider environment to retarget CLI or application commands. */
export function cleanChildEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(SUPABASE_|WYP_|VERCEL_|TURNSTILE_|NEXT_PUBLIC_SUPABASE_|NEXT_PUBLIC_APP_URL$|NEXT_PUBLIC_TURNSTILE_|DATABASE_URL$|PG[A-Z_]+$)/.test(key)));
}

/** Never enable media merely because a database URL looks local. Prove container ownership too. */
function runLocalMaintenance(rootPath, filename, { execute = execFileSync, env = process.env } = {}) {
  const target = readLocalProject(rootPath), container = `supabase_db_${target.projectId}`;
  const options = { cwd: target.workspace, env: cleanChildEnvironment(env), encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 * 1024 };
  let labels;
  try { labels = JSON.parse(execute("docker", ["inspect", container, "--format", "{{json .Config.Labels}}"], options)); }
  catch { throw new Error("Cannot establish local database container ownership."); }
  if (labels?.["com.supabase.cli.project"] !== target.projectId
    || labels?.["com.supabase.cli.workdir"] !== target.workspace) {
    throw new Error("Local database container ownership does not match this project.");
  }
  const input = readFileSync(join(target.workspace, "supabase/maintenance", filename), "utf8");
  try { execute("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1"], { ...options, input }); }
  catch { throw new Error("Local source-capability maintenance failed; no remote target was used."); }
}

export function configureLocalCapabilities(rootPath, options) {
  return runLocalMaintenance(rootPath, "configure_local_capabilities.sql", options);
}

export function assertLocalHostedReady(rootPath, options) {
  return runLocalMaintenance(rootPath, "assert_hosted_ready.sql", options);
}
