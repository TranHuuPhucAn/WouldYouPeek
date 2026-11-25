import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertHostedIdentity, readHostedTarget, privateFile, outsideCheckout, safeTargetSummary, hostedEnvironment, hostedSchemaConnection, runProtected, runHostedSql, parseHostedArguments } from "../../scripts/hosted-target.mjs";

const project = "a".repeat(20), production = "b".repeat(20);
const target = () => ({ schemaVersion: 1, environment: "preview", projectRef: project, productionProjectRef: production, appOrigin: "https://staging.example.com", database: { host: `db.${project}.supabase.co`, user: "postgres", port: 5432, name: "postgres" } });
function temporary(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "wyp-hosted-target-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "checkout");
  mkdirSync(root);
  return { directory, root };
}
function caFixture(t) {
  const value = temporary(t), path = join(value.directory, "trusted CA +#&%.crt"), now = Date.now();
  const pem = rootCertificates.find((candidate) => {
    const certificate = new X509Certificate(candidate);
    return certificate.ca && Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo);
  });
  assert.ok(pem, "Node provides a current public CA for an isolated fixture");
  writeFileSync(path, pem, { mode: 0o600 });
  return { ...value, path, pem };
}

test("hosted identity binds production and preview to distinct explicit projects", () => {
  const accepted = assertHostedIdentity(target(), project, "preview");
  assert.equal(accepted.database.host, `db.${project}.supabase.co`);
  assert.ok(Object.isFrozen(accepted));
  assert.ok(Object.isFrozen(accepted.database));
  const prod = { ...target(), environment: "production", productionProjectRef: project };
  assert.equal(assertHostedIdentity(prod, project, "production").environment, "production");
  for (const [value, ref, environment] of [
    [target(), production, "preview"], [target(), project, "production"],
    [{ ...target(), productionProjectRef: project }, project, "preview"],
    [{ ...target(), environment: "production" }, project, "production"],
    [target(), project, "local"], [{ ...target(), password: "synthetic-sensitive-value" }, project, "preview"],
  ]) assert.throws(() => assertHostedIdentity(value, ref, environment));
});

test("hosted origin rejects credentials, paths, insecure URLs and local names", () => {
  for (const appOrigin of ["http://staging.example.com", "https://user:synthetic-sensitive-value@staging.example.com", "https://staging.example.com/path", "https://staging.example.com?token=x", "https://staging.example.com#x", "https://staging.example.com:444", "https://localhost", "https://site.localhost", "https://site.local", "https://site.test", "https://127.0.0.1"])
    assert.throws(() => assertHostedIdentity({ ...target(), appOrigin }, project, "preview"));
});

test("only target-bound direct or session-pooler database identities are accepted", () => {
  const database = { host: "aws-1-ap-southeast-2.pooler.supabase.com", user: `postgres.${project}`, port: 5432, name: "postgres" };
  assert.equal(assertHostedIdentity({ ...target(), database }, project, "preview").database.host, database.host);
  for (const patch of [{ user: `postgres.${production}` }, { host: "attacker.example.com" }, { port: 6543 }, { name: "other" }, { password: "synthetic-sensitive-value" }])
    assert.throws(() => assertHostedIdentity({ ...target(), database: { ...database, ...patch } }, project, "preview"));
});

test("target configuration must be a private regular file outside the checkout", (t) => {
  const { directory, root } = temporary(t), path = join(directory, "target.json");
  writeFileSync(path, JSON.stringify(target()), { mode: 0o600 });
  assert.deepEqual(readHostedTarget(path, project, "preview", { root }), target());
  assert.equal(privateFile(path, root), path);
  chmodSync(path, 0o644);
  assert.throws(() => readHostedTarget(path, project, "preview", { root }), /private/);
  chmodSync(path, 0o600);
  const inside = join(root, "target.json");
  writeFileSync(inside, JSON.stringify(target()), { mode: 0o600 });
  assert.throws(() => readHostedTarget(inside, project, "preview", { root }), /outside/);
  assert.throws(() => privateFile(directory, root), /regular/);
  assert.throws(() => outsideCheckout(root, root), /outside/);
});

test("symlinked files and parent directories cannot redirect a hosted target", (t) => {
  const { directory, root } = temporary(t), storage = join(directory, "private");
  mkdirSync(storage);
  const path = join(storage, "target.json"), alias = join(directory, "alias.json");
  writeFileSync(path, JSON.stringify(target()), { mode: 0o600 });
  symlinkSync(path, alias);
  assert.throws(() => readHostedTarget(alias, project, "preview", { root }), /symlink/);
  const parent = join(directory, "parent-alias");
  symlinkSync(storage, parent, "dir");
  assert.throws(() => readHostedTarget(join(parent, "target.json"), project, "preview", { root }), /symlink/);
});

test("parse failures and safe summaries do not echo configuration contents", (t) => {
  const { directory, root } = temporary(t), path = join(directory, "target.json");
  writeFileSync(path, '{"secret":"synthetic-sensitive-value"', { mode: 0o600 });
  assert.throws(() => readHostedTarget(path, project, "preview", { root }), (error) => !error.message.includes("synthetic-sensitive-value"));
  assert.deepEqual(safeTargetSummary(target()), { projectRef: project, environment: "preview", appOrigin: "https://staging.example.com" });
});

test("hosted child environment fixes TLS and drops inherited cloud/local target selectors", () => {
  const env = hostedEnvironment(target(), { PATH: "/synthetic/bin", WYP_HOSTED_DB_PASSWORD: "synthetic-db-secret", WYP_HOSTED_ACCESS_TOKEN: "synthetic-api-secret", WYP_TEST_PROJECT_ID: "local", PGHOST: "attacker.example", PGSERVICE: "other", PGPASSFILE: "/unsafe", PGSSLMODE: "disable", DATABASE_URL: "postgres://unsafe", SUPABASE_ACCESS_TOKEN: "inherited", VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "http://localhost" });
  assert.equal(env.PGHOST, `db.${project}.supabase.co`);
  assert.equal(env.PGUSER, "postgres");
  assert.equal(env.PGSSLMODE, "verify-full");
  assert.equal(env.PGSSLROOTCERT, "system");
  assert.equal(env.PGPASSWORD, "synthetic-db-secret");
  assert.equal(env.SUPABASE_ACCESS_TOKEN, "synthetic-api-secret");
  for (const name of ["WYP_HOSTED_DB_PASSWORD", "WYP_TEST_PROJECT_ID", "PGSERVICE", "PGPASSFILE", "DATABASE_URL", "VERCEL_ENV", "NEXT_PUBLIC_APP_URL"]) assert.equal(env[name], undefined);
  assert.throws(() => hostedEnvironment(target(), {}), /protected environment/);
});

test("schema comparison binds verified TLS to a password-free direct or pooler URL only", (t) => {
  const { root, path } = caFixture(t), password = "synthetic-secret :@/?#%", token = "synthetic-api-secret";
  const input = { WYP_HOSTED_DB_PASSWORD: password, WYP_HOSTED_CA_FILE: path, WYP_HOSTED_ACCESS_TOKEN: token,
    PGSSLMODE: "disable", PGSSLROOTCERT: "/unsafe", PGSSLCERT: "/unsafe-client", PGSSLKEY: "/unsafe-key", SUPABASE_ACCESS_TOKEN: "inherited" };
  const before = { ...input };
  for (const database of [target().database, { host: "aws-1-ap-northeast-1.pooler.supabase.com", user: `postgres.${project}`, port: 5432, name: "postgres" }]) {
    const configured = { ...target(), database }, comparison = hostedSchemaConnection(configured, input, { root }), url = new URL(comparison.url);
    assert.equal(url.protocol, "postgresql:");
    assert.equal(url.hostname, database.host);
    assert.equal(url.username, database.user);
    assert.equal(url.password, "");
    assert.equal(url.port, "5432");
    assert.equal(url.pathname, "/postgres");
    assert.deepEqual([...url.searchParams.keys()], ["sslmode", "sslrootcert"]);
    assert.equal(url.searchParams.get("sslmode"), "verify-full");
    assert.equal(url.searchParams.get("sslrootcert"), path);
    for (const value of [password, encodeURI(password), encodeURIComponent(password), token]) assert.ok(!comparison.url.includes(value));
    assert.equal(comparison.env.PGPASSWORD, password);
    assert.equal(comparison.env.PGHOST, database.host);
    assert.equal(comparison.env.PGUSER, database.user);
    assert.equal(comparison.env.SUPABASE_ACCESS_TOKEN, "");
    assert.equal(comparison.env.SUPABASE_NO_KEYRING, "1");
    assert.deepEqual(Object.keys(comparison.env).filter((key) => key.startsWith("PGSSL")), []);
    const standard = hostedEnvironment(configured, input);
    assert.equal(standard.PGSSLMODE, "verify-full");
    assert.equal(standard.PGSSLROOTCERT, path);
    assert.equal(standard.SUPABASE_ACCESS_TOKEN, token);
  }
  assert.deepEqual(input, before);
});

test("schema comparison rejects unavailable or unsafe CA inputs without a fallback", (t) => {
  const { directory, root, path, pem } = caFixture(t), env = { WYP_HOSTED_DB_PASSWORD: "synthetic-secret" };
  for (const ca of [undefined, "system", "relative.crt", join(directory, "missing.crt"), directory])
    assert.throws(() => hostedSchemaConnection(target(), { ...env, WYP_HOSTED_CA_FILE: ca }, { root }), /explicit valid private CA/);
  const malformed = join(directory, "malformed.crt");
  writeFileSync(malformed, "synthetic-sensitive-value", { mode: 0o600 });
  assert.throws(() => hostedSchemaConnection(target(), { ...env, WYP_HOSTED_CA_FILE: malformed }, { root }), (error) => /explicit valid private CA/.test(error.message) && !error.message.includes("synthetic-sensitive-value"));
  chmodSync(path, 0o644);
  assert.throws(() => hostedSchemaConnection(target(), { ...env, WYP_HOSTED_CA_FILE: path }, { root }), /explicit valid private CA/);
  chmodSync(path, 0o600);
  const alias = join(directory, "ca-alias.crt");
  symlinkSync(path, alias);
  assert.throws(() => hostedSchemaConnection(target(), { ...env, WYP_HOSTED_CA_FILE: alias }, { root }), /explicit valid private CA/);
  const inside = join(root, "ca.crt");
  writeFileSync(inside, pem, { mode: 0o600 });
  assert.throws(() => hostedSchemaConnection(target(), { ...env, WYP_HOSTED_CA_FILE: inside }, { root }), /explicit valid private CA/);
  assert.throws(() => hostedSchemaConnection({ ...target(), database: { ...target().database, host: "attacker.example.com" } }, { ...env, WYP_HOSTED_CA_FILE: path }, { root }), /identity/);
});

test("protected command failures omit stderr, stdout and sensitive exception details", () => {
  assert.throws(() => runProtected("/bin/psql", [], { execute() { throw Object.assign(new Error("synthetic-sensitive-value"), { stderr: "private SQL", stdout: "private users" }); } }), (error) => {
    assert.match(error.message, /Protected psql operation failed/);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /synthetic-sensitive|private SQL|private users/);
    return true;
  });
});

test("SQL uses fixed stdin and target-bound environment without secret arguments", () => {
  let observed;
  const output = runHostedSql(target(), "select 1;", { env: { WYP_HOSTED_DB_PASSWORD: "synthetic-db-secret" }, execute(command, args, options) { observed = { command, args, options }; return "1\n"; } });
  assert.equal(output, "1\n");
  assert.equal(observed.command, "psql");
  assert.equal(observed.options.input, "select 1;");
  assert.equal(observed.options.env.PGSSLMODE, "verify-full");
  assert.doesNotMatch(JSON.stringify(observed.args), /synthetic-db-secret/);
  assert.deepEqual(observed.options.stdio, ["pipe", "pipe", "pipe"]);
});

test("hosted argument parsing requires exact targets and rejects duplicate/unknown flags", () => {
  const flags = ["--target", "/private/target.json", "--project", project, "--environment", "preview"];
  assert.equal(parseHostedArguments(["inspect", ...flags], ["inspect"]).project, project);
  for (const args of [["reset", ...flags], ["inspect"], ["inspect", ...flags, "--project", production], ["inspect", ...flags, "--unknown", "x"], ["inspect", ...flags, "--sha"], ["inspect", "--target", "--project", project, "--environment", "preview"]])
    assert.throws(() => parseHostedArguments(args, ["inspect"]));
});

test("default protected Git calls cannot inherit selectors that point at another repository", () => {
  const oldDir = process.env.GIT_DIR, oldTree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = "/synthetic/other/.git";
    process.env.GIT_WORK_TREE = "/synthetic/other";
    runProtected("git", ["rev-parse", "HEAD"], { execute(_command, _args, options) {
      assert.equal(options.env.GIT_DIR, undefined);
      assert.equal(options.env.GIT_WORK_TREE, undefined);
      return "synthetic-head";
    } });
  } finally {
    if (oldDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldDir;
    if (oldTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = oldTree;
  }
});
