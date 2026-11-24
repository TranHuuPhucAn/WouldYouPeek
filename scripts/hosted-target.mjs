import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanChildEnvironment } from "./local-target.mjs";

export const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PROJECT_REF = /^[a-z]{20}$/;
export const SHA = /^[a-f0-9]{40}$/;
export const REPOSITORY = "TranHuuPhucAn/WouldYouPeek";

export function outsideCheckout(path, root = PROJECT_ROOT) {
  const absolute = realpathSync(path), checkout = realpathSync(root), rel = relative(checkout, absolute);
  if (!rel || (!(rel === ".." || rel.startsWith(`..${sep}`)) && !isAbsolute(rel)) || absolute !== resolve(path) || lstatSync(resolve(path)).isSymbolicLink()) {
    throw new Error("Hosted configuration and backups must be outside the checkout and not symlinks.");
  }
  return absolute;
}

export function privateFile(path, root = PROJECT_ROOT) {
  const file = outsideCheckout(path, root), stat = lstatSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Expected a private regular file (chmod 600).");
  return file;
}

/** The caller must repeat both target identity and environment; linked CLI state is never authority. */
export function assertHostedIdentity(value, expectedProjectRef, expectedEnvironment) {
  if (!value || value.schemaVersion !== 1 || !PROJECT_REF.test(expectedProjectRef ?? "")
    || value.projectRef !== expectedProjectRef || value.environment !== expectedEnvironment
    || !["preview", "production"].includes(expectedEnvironment)
    || !PROJECT_REF.test(value.productionProjectRef ?? "")
    || (expectedEnvironment === "production") !== (value.projectRef === value.productionProjectRef)) {
    throw new Error("Hosted project identity/environment does not match the explicit target.");
  }
  let origin;
  try { origin = new URL(value.appOrigin); } catch { throw new Error("Invalid hosted application origin."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.port
    || origin.pathname !== "/" || origin.search || origin.hash
    || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(origin.hostname)
    || /(^|\.)(localhost|local|test|invalid)$/.test(origin.hostname)) throw new Error("Expected a canonical HTTPS application origin.");
  const db = value.database;
  const direct = db?.host === `db.${value.projectRef}.supabase.co` && db?.user === "postgres";
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(db?.host ?? "") && db?.user === `postgres.${value.projectRef}`;
  if ((!direct && !pooler) || db.port !== 5432 || db.name !== "postgres"
    || Object.keys(db).some((key) => !["host", "port", "user", "name"].includes(key))) {
    throw new Error("Expected an exact Supabase direct or session-pooler database identity without embedded secrets.");
  }
  if (Object.keys(value).some((key) => !["schemaVersion", "environment", "projectRef", "productionProjectRef", "appOrigin", "database"].includes(key))) {
    throw new Error("Unexpected hosted target configuration field.");
  }
  return Object.freeze({ ...value, appOrigin: origin.origin, database: Object.freeze({ ...db }) });
}

export function readHostedTarget(path, projectRef, environment, { root = PROJECT_ROOT } = {}) {
  const file = privateFile(path, root);
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("Cannot read hosted target configuration."); }
  return assertHostedIdentity(parsed, projectRef, environment);
}

export function safeTargetSummary(target) {
  return { projectRef: target.projectRef, environment: target.environment, appOrigin: target.appOrigin };
}

export function hostedEnvironment(target, env = process.env) {
  if (!env.WYP_HOSTED_DB_PASSWORD) throw new Error("Set WYP_HOSTED_DB_PASSWORD through a protected environment.");
  const clean = cleanChildEnvironment(env);
  // Do not allow inherited libpq service files, CLI profiles or .env settings to retarget the operation.
  return { ...clean, PGHOST: target.database.host, PGPORT: "5432", PGUSER: target.database.user,
    PGDATABASE: "postgres", PGPASSWORD: env.WYP_HOSTED_DB_PASSWORD, PGSSLMODE: "verify-full",
    PGSSLROOTCERT: env.WYP_HOSTED_CA_FILE || "system", PGCONNECT_TIMEOUT: "15",
    SUPABASE_ACCESS_TOKEN: env.WYP_HOSTED_ACCESS_TOKEN || "" };
}

/** Bind TLS to the hosted URL so the CLI's separate local shadow cannot inherit it. */
export function hostedSchemaConnection(target, env = process.env, { root = PROJECT_ROOT } = {}) {
  const identity = assertHostedIdentity(target, target?.projectRef, target?.environment);
  let ca;
  try {
    // Native CLI 3.2 reads sslrootcert as a filename; libpq's "system" is not supported here.
    if (typeof env.WYP_HOSTED_CA_FILE !== "string" || !isAbsolute(env.WYP_HOSTED_CA_FILE)) throw new Error();
    ca = privateFile(env.WYP_HOSTED_CA_FILE, root);
    const pem = readFileSync(ca, "utf8"), certificate = new X509Certificate(pem), now = Date.now();
    if (!pem.trim().startsWith("-----BEGIN CERTIFICATE-----") || !pem.trim().endsWith("-----END CERTIFICATE-----")
      || !certificate.ca || !(Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo))) throw new Error();
  } catch { throw new Error("Hosted schema comparison requires an explicit valid private CA file outside the checkout."); }
  const url = new URL("postgresql://localhost");
  url.hostname = identity.database.host;
  url.port = String(identity.database.port);
  url.username = identity.database.user;
  url.pathname = "/postgres";
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.set("sslrootcert", ca);
  const childEnv = hostedEnvironment(identity, env);
  for (const key of Object.keys(childEnv)) if (key.startsWith("PGSSL")) delete childEnv[key];
  childEnv.SUPABASE_ACCESS_TOKEN = "";
  childEnv.SUPABASE_NO_KEYRING = "1";
  return { url: url.href, env: childEnv };
}

/** Child output can contain credentials or private SQL data. Never attach it to a thrown error. */
export function runProtected(command, args, { env, input, cwd = PROJECT_ROOT, execute = execFileSync, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const safeEnv = env ?? Object.fromEntries(Object.entries(cleanChildEnvironment()).filter(([key]) => !key.startsWith("GIT_")));
  try { return execute(command, args, { cwd, env: safeEnv, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer, timeout: 15 * 60_000 }); }
  catch { throw new Error(`Protected ${command.split(/[\\/]/).at(-1)} operation failed; inspect privately without publishing credentials.`); }
}

export function runHostedSql(target, sql, { env = process.env, execute = execFileSync, root = PROJECT_ROOT } = {}) {
  return runProtected("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1"], { env: hostedEnvironment(target, env), input: sql, execute, cwd: root });
}

export function parseHostedArguments(args, commands, extraFlags = []) {
  const [command, ...rest] = args;
  if (!commands.includes(command) || rest.length % 2) throw new Error("Use a documented hosted command and explicit target flags.");
  const flags = {};
  const allowed = new Set(["target", "project", "environment", ...extraFlags]);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].replace(/^--/, "");
    if (!rest[index].startsWith("--") || !allowed.has(key) || key in flags || !rest[index + 1] || rest[index + 1].startsWith("--")) {
      throw new Error("Unknown, duplicate or missing hosted argument.");
    }
    flags[key] = rest[index + 1];
  }
  if (!["target", "project", "environment"].every((key) => flags[key])) throw new Error("Hosted commands require target, project and environment.");
  return { command, ...flags };
}
