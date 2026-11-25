import { createHmac } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanChildEnvironment,
  localUrl,
  readLocalProject,
} from "./local-target.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
export const MEDIA_CONFIG_FILE = ".env.media-worker.json";
export const MEDIA_VALIDATOR_ROLE = "wyp_media_validator";

function helperEnvironment(env) {
  const result = cleanChildEnvironment(env);
  for (const key of Object.keys(result)) {
    if (
      /^(WYP_MEDIA_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS_VERIFY$|DOCKER_CERT_PATH$|NODE_OPTIONS$)/.test(
        key,
      )
    )
      delete result[key];
  }
  return result;
}

export function parseMediaCommand(args) {
  if (args.length !== 1 || !["setup", "check", "worker"].includes(args[0]))
    throw new Error(
      "Use npm run media:setup, media:check, or media:worker without extra arguments.",
    );
  return args[0];
}

export function mintScopedValidatorToken(
  secret,
  projectId,
  { now = Math.floor(Date.now() / 1000), lifetimeSeconds = 8 * 60 * 60 } = {},
) {
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    !/^(would-you-peek|wyp-test-[0-9a-f-]{31})$/.test(projectId) ||
    !Number.isInteger(lifetimeSeconds) ||
    lifetimeSeconds < 60 ||
    lifetimeSeconds > 8 * 60 * 60 ||
    !Number.isInteger(now)
  )
    throw new Error("Invalid local validator signing configuration.");
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const claims = encode({
    role: MEDIA_VALIDATOR_ROLE,
    aud: "authenticated",
    iss: "supabase",
    wyp_project_id: projectId,
    iat: now,
    exp: now + lifetimeSeconds,
  });
  const body = `${header}.${claims}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function checkMediaPrerequisites({
  root = defaultRoot,
  env = process.env,
  execute = execFileSync,
} = {}) {
  const target = readLocalProject(root);
  const ffprobePath = env.WYP_FFPROBE_PATH || "ffprobe";
  if (
    typeof ffprobePath !== "string" ||
    !ffprobePath ||
    ffprobePath.includes("\0")
  )
    throw new Error("Invalid ffprobe executable path.");
  try {
    const version = execute(ffprobePath, ["-version"], {
      cwd: target.workspace,
      env: helperEnvironment(env),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!String(version).startsWith("ffprobe version")) throw new Error();
  } catch {
    throw new Error(
      "Install FFmpeg with ffprobe, or configure WYP_FFPROBE_PATH, before starting media validation.",
    );
  }
  return { target, ffprobePath };
}

function assertPublicKey(key) {
  if (typeof key !== "string" || !key)
    throw new Error("Local public API key unavailable.");
  if (key.startsWith("sb_publishable_")) return;
  try {
    if (
      JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"))
        .role === "anon"
    )
      return;
  } catch {
    /* Fail closed below. */
  }
  throw new Error(
    "Media configuration requires the public API key, not an administrator key.",
  );
}

function bindLocalValidatorProject(target, env, execute) {
  const container = `supabase_db_${target.projectId}`;
  const options = {
    cwd: target.workspace,
    env: helperEnvironment(env),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  };
  let labels;
  try {
    labels = JSON.parse(
      execute(
        "docker",
        ["inspect", container, "--format", "{{json .Config.Labels}}"],
        options,
      ),
    );
  } catch {
    throw new Error(
      "The exact local database container is unavailable for validator setup.",
    );
  }
  if (
    labels?.["com.supabase.cli.project"] !== target.projectId ||
    labels?.["com.supabase.cli.workdir"] !== target.workspace
  )
    throw new Error(
      "Database container ownership does not match this local project.",
    );
  const statement = `insert into private.media_validator_identity (singleton, project_id)
values (true, :'project_id')
on conflict (singleton) do update set project_id = excluded.project_id
returning project_id;\n`;
  let bound;
  try {
    bound = execute(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `project_id=${target.projectId}`,
      ],
      { ...options, input: statement, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    throw new Error(
      "Local validator project binding failed. Apply the media migrations first.",
    );
  }
  if (String(bound).trim() !== target.projectId)
    throw new Error("Local validator project binding could not be confirmed.");
}

export function prepareLocalValidator({
  root = defaultRoot,
  env = process.env,
  execute = execFileSync,
  log = console.log,
} = {}) {
  const { target, ffprobePath } = checkMediaPrerequisites({
    root,
    env,
    execute,
  });
  let status;
  try {
    status = JSON.parse(
      execute(
        resolve(target.workspace, "node_modules/.bin/supabase"),
        ["status", "-o", "json"],
        {
          cwd: target.workspace,
          env: helperEnvironment(env),
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
  } catch {
    throw new Error(
      "Local Supabase status is unavailable. Run npm run db:start first.",
    );
  }
  const apiUrl = localUrl(status.API_URL, target.ports.api);
  const publishableKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
  assertPublicKey(publishableKey);
  if (typeof status.JWT_SECRET !== "string" || status.JWT_SECRET.length < 32)
    throw new Error("Local validator signing configuration is unavailable.");
  bindLocalValidatorProject(target, env, execute);
  const validatorToken = mintScopedValidatorToken(
    status.JWT_SECRET,
    target.projectId,
  );
  const config = {
    schemaVersion: 1,
    projectId: target.projectId,
    apiUrl,
    publishableKey,
    validatorToken,
    ffprobePath,
  };
  const configPath = resolve(target.workspace, MEDIA_CONFIG_FILE);
  let descriptor;
  try {
    // O_NOFOLLOW protects the credential destination; the root was already resolved/verified.
    descriptor = openSync(
      configPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const claims = JSON.parse(
    Buffer.from(validatorToken.split(".")[1], "base64url").toString("utf8"),
  );
  log(
    "Prepared an ignored local media credential restricted to video validation. It expires in eight hours.",
  );
  return { configPath, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

export function readLocalValidatorConfig({ root = defaultRoot } = {}) {
  const target = readLocalProject(root);
  const configPath = resolve(target.workspace, MEDIA_CONFIG_FILE);
  const stat = lstatSync(configPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    realpathSync(configPath) !== configPath ||
    stat.size > 16_384 ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  )
    throw new Error(
      "The media credential must be a private regular file. Run npm run media:setup.",
    );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    config.schemaVersion !== 1 ||
    config.projectId !== target.projectId ||
    Object.keys(config).some(
      (key) =>
        ![
          "schemaVersion",
          "projectId",
          "apiUrl",
          "publishableKey",
          "validatorToken",
          "ffprobePath",
        ].includes(key),
    )
  )
    throw new Error("Media credential project identity is invalid.");
  localUrl(config.apiUrl, target.ports.api);
  assertPublicKey(config.publishableKey);
  try {
    const parts = config.validatorToken.split(".");
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (
      parts.length !== 3 ||
      !parts[2] ||
      header.alg !== "HS256" ||
      claims.role !== MEDIA_VALIDATOR_ROLE ||
      claims.wyp_project_id !== target.projectId ||
      !Number.isInteger(claims.exp) ||
      !Number.isInteger(claims.iat) ||
      claims.exp <= Date.now() / 1000 + 15 ||
      claims.iat > Date.now() / 1000 + 30 ||
      claims.exp - claims.iat > 8 * 60 * 60
    )
      throw new Error();
  } catch {
    throw new Error(
      "Media validator credential expired or has the wrong scope. Run npm run media:setup.",
    );
  }
  return { target, configPath, config };
}

export function startMediaValidator({
  root = defaultRoot,
  env = process.env,
  launch = spawn,
  once = false,
  stdio = ["ignore", "pipe", "pipe"],
} = {}) {
  const { target, configPath, config } = readLocalValidatorConfig({ root });
  const workerEnv = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
  // Supabase administrator credentials and signing secrets never reach the worker environment.
  if (!config.ffprobePath) throw new Error("Local ffprobe is not configured.");
  // Loading tsx in this Node process avoids an extra CLI child that could outlive cleanup.
  const child = launch(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve(target.workspace, "src/worker/media/main.ts"),
      "--config",
      configPath,
      ...(once ? ["--once"] : []),
    ],
    { cwd: target.workspace, env: workerEnv, stdio },
  );
  return child;
}

export async function stopMediaValidator(child, { timeoutMs = 3000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolveStop();
    };
    child.once("exit", done);
    child.once("error", done);
    child.kill("SIGTERM");
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const command = parseMediaCommand(process.argv.slice(2));
    if (command === "setup") prepareLocalValidator();
    else if (command === "check") {
      checkMediaPrerequisites();
      readLocalValidatorConfig();
      console.log(
        "Local media validation prerequisites and scoped credential are ready.",
      );
    } else {
      checkMediaPrerequisites();
      const child = startMediaValidator();
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
      const stop = () => {
        void stopMediaValidator(child);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      child.once("error", () => {
        console.error("The local media worker could not start.");
        process.exitCode = 1;
      });
      child.once("exit", (code, signal) => {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
        process.exitCode = signal ? 1 : (code ?? 1);
      });
    }
  } catch {
    console.error(
      "Local media command failed. Check local Supabase, FFmpeg, and npm run media:setup.",
    );
    process.exitCode = 1;
  }
}
