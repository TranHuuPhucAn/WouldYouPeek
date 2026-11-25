import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyInventory, exportBackup, validateBackupManifest, restoreIntoDisposableTarget } from "../../scripts/hosted-backup.mjs";
import { migrationManifest } from "../../scripts/hosted-release.mjs";
import { fixtureProject } from "./helpers.mjs";

const SHA = "a".repeat(40), source = "a".repeat(20), destination = "b".repeat(20);
const data = "COPY auth.users (id, email) FROM stdin;\n1\tprivate@example.test\n\\.\nCOPY private.deployment_settings (id, source_mode) FROM stdin;\n1\tyoutube-only\n\\.\nCOPY public.scenarios (id) FROM stdin;\none\n\\.\n";
const makeTarget = (ref, environment) => ({ schemaVersion: 1, projectRef: ref, productionProjectRef: source, environment,
  appOrigin: "https://wyp.example.com", database: { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", name: "postgres" } });

function fixture(t) {
  const root = fixtureProject(t), parent = realpathSync(mkdtempSync(join(tmpdir(), "wyp-backup-")));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const identity = join(parent, "recovery.agekey");
  execFileSync("age-keygen", ["-o", identity], { stdio: "pipe" });
  const recipient = execFileSync("age-keygen", ["-y", identity], { encoding: "utf8" }).trim();
  const ca = join(parent, "trusted CA +#&%.crt"), now = Date.now();
  const pem = rootCertificates.find((value) => {
    const certificate = new X509Certificate(value);
    return certificate.ca && Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo);
  });
  assert.ok(pem, "Node provides a current public CA for an isolated fixture");
  writeFileSync(ca, pem, { mode: 0o600 });
  writeFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "select 'readiness';");
  const mutations = [];
  const options = { root, sha: SHA, destination: parent, recipient, env: { ...process.env, WYP_HOSTED_DB_PASSWORD: "never-in-argv", WYP_HOSTED_ACCESS_TOKEN: "never-in-output", WYP_HOSTED_CA_FILE: ca },
    state: () => ({ versions: migrationManifest(root).map((row) => row.version), accounts: 1, objects: 0 }),
    sql(target, input) {
      if (input.startsWith("begin;")) mutations.push(input);
      if (input.startsWith("copy auth.")) return "1\tprivate@example.test\n";
      if (input.startsWith("copy private.")) return "1\tyoutube-only\n";
      if (input.startsWith("copy public.")) return "one\n";
      return "";
    },
    run(command, args, config) {
      assert.equal(args.some((arg) => arg.includes("never-in-")), false);
      if (command === "git") return args[0] === "rev-parse" ? SHA : "";
      if (command.endsWith("/supabase") && args[0] === "db") return "-- No schema changes\n";
      if (command === "pg_dumpall") return "-- custom role schema evidence\n";
      if (command === "pg_dump") return args.includes("--data-only") ? data : "-- schema evidence\n";
      if (command.endsWith("/supabase")) { mutations.push(args); return ""; }
      return execFileSync(command, args, { input: config?.input, env: config?.env, encoding: "utf8", stdio: "pipe" });
    } };
  return { root, parent, identity, ca, options, mutations };
}

test("COPY inventory preserves escaped rows and rejects truncated/missing/unsafe schemas", () => {
  const inventory = copyInventory(data);
  assert.equal(inventory.length, 3);
  assert.equal(inventory[0].rows, 1);
  assert.throws(() => copyInventory(data.replace("\\.\n", "")), /missing|Truncated|Unsupported/i);
  assert.throws(() => copyInventory(data.replace("auth.users", "evil.users")), /Unsupported/);
  assert.throws(() => copyInventory(data + data), /Duplicate/);
});

test("real age encryption keeps plaintext off disk and allows a complete authenticated restore", (t) => {
  const f = fixture(t), target = makeTarget(source, "production");
  const result = exportBackup(target, f.options);
  const manifest = validateBackupManifest(result.manifest, { root: f.root, target });
  assert.deepEqual(readdirSync(manifest.directory).sort(), ["data.sql.age", "managed-schema.sql.age", "manifest.json", "roles.sql.age", "schema.sql.age"]);
  for (const name of readdirSync(manifest.directory)) assert.doesNotMatch(readFileSync(join(manifest.directory, name), "utf8"), /private@example|never-in-/);
  const restored = restoreIntoDisposableTarget(makeTarget(destination, "preview"), { ...f.options, manifestPath: result.manifest, identity: f.identity,
    state: () => ({ versions: [], accounts: 0, objects: 0 }) });
  assert.equal(restored.tables, 3);
  assert.equal(restored.data, "verified");
  assert.deepEqual(f.mutations[0], ["migration", "up", `--remote=${destination}`, "--yes"]);
  const restoreSql = f.mutations[1];
  assert.match(restoreSql, /set local session_replication_role=replica;/);
  assert.match(restoreSql, /lock table[^;]+in access exclusive mode;/i);
  const lockIndex = restoreSql.toLowerCase().indexOf("lock table");
  const guardIndex = restoreSql.toLowerCase().indexOf("from auth.users");
  const truncateIndex = restoreSql.toLowerCase().indexOf("truncate ");
  assert.ok(lockIndex >= 0 && guardIndex > lockIndex && truncateIndex > guardIndex, "lock and recheck the destination before truncating any rows");
});

test("production, same-source and nonempty restore targets are rejected before mutation", (t) => {
  const f = fixture(t), result = exportBackup(makeTarget(source, "production"), f.options);
  for (const target of [makeTarget(source, "production"), makeTarget(source, "preview")]) {
    assert.throws(() => restoreIntoDisposableTarget(target, { ...f.options, manifestPath: result.manifest, identity: f.identity }), /different|disposable/);
  }
  assert.throws(() => restoreIntoDisposableTarget(makeTarget(destination, "preview"), { ...f.options, manifestPath: result.manifest, identity: f.identity,
    state: () => ({ versions: [], accounts: 1, objects: 0 }) }), /empty/);
  assert.deepEqual(f.mutations, []);
});

test("wrong decryption key, corrupt ciphertext and missing files cannot reach mutation", (t) => {
  const f = fixture(t), result = exportBackup(makeTarget(source, "production"), f.options);
  const wrong = join(f.parent, "wrong.agekey"); execFileSync("age-keygen", ["-o", wrong], { stdio: "pipe" });
  assert.throws(() => restoreIntoDisposableTarget(makeTarget(destination, "preview"), { ...f.options, manifestPath: result.manifest, identity: wrong,
    state: () => ({ versions: [], accounts: 0, objects: 0 }) }));
  assert.deepEqual(f.mutations, []);
  const manifest = validateBackupManifest(result.manifest, { root: f.root });
  writeFileSync(join(manifest.directory, "data.sql.age"), "corrupt");
  assert.throws(() => validateBackupManifest(result.manifest, { root: f.root }), /integrity/);
});

test("failed encryption cleans up only its newly owned incomplete export", (t) => {
  const f = fixture(t), sentinel = join(f.parent, "keep.txt"); writeFileSync(sentinel, "keep");
  assert.throws(() => exportBackup(makeTarget(source, "production"), { ...f.options, run(command, args, config) {
    if (args.includes("--encrypt")) throw new Error("encryption unavailable");
    return f.options.run(command, args, config);
  } }), /encryption unavailable/);
  assert.equal(readdirSync(f.parent).some((name) => name.startsWith("backup-")), false);
  assert.equal(readFileSync(sentinel, "utf8"), "keep");
});

test("a changed migration or restored row cannot be reported as a successful recovery", (t) => {
  const f = fixture(t), result = exportBackup(makeTarget(source, "production"), f.options);
  assert.throws(() => restoreIntoDisposableTarget(makeTarget(destination, "preview"), { ...f.options, manifestPath: result.manifest, identity: f.identity,
    state: () => ({ versions: [], accounts: 0, objects: 0 }), sql(target, input) { return input.startsWith("copy auth.") ? "2\tother@example.test\n" : f.options.sql(target, input); } }), /does not match/);
  f.mutations.length = 0;
  writeFileSync(join(f.root, "supabase/migrations/20261117000500_baseline.sql"), "-- changed\n");
  assert.throws(() => restoreIntoDisposableTarget(makeTarget(destination, "preview"), { ...f.options, manifestPath: result.manifest, identity: f.identity }), /exact reviewed/);
  assert.deepEqual(f.mutations, []);
});

test("source schema drift or unreviewed checkout stops before writing backup files", (t) => {
  const f = fixture(t);
  for (const drift of ["schema", "checkout"]) {
    assert.throws(() => exportBackup(makeTarget(source, "production"), { ...f.options, run(command, args, config) {
      if (drift === "schema" && command.endsWith("/supabase") && args[0] === "db") return "alter table public.scenarios add column unexpected text;";
      if (drift === "checkout" && command === "git" && args[0] === "status") return " M supabase/migrations/change.sql";
      return f.options.run(command, args, config);
    } }), /schema|checkout/);
    assert.equal(readdirSync(f.parent).some((name) => name.startsWith("backup-")), false);
  }
});

test("backup compares one explicit verified host without a PAT or global shadow TLS", (t) => {
  const f = fixture(t), observed = [];
  const env = { ...f.options.env };
  delete env.WYP_HOSTED_ACCESS_TOKEN;
  const result = exportBackup(makeTarget(source, "production"), { ...f.options, env, run(command, args, config) {
    observed.push({ command, args, env: config?.env });
    return f.options.run(command, args, config);
  } });
  assert.equal(result.encryptedFiles, 4);
  const comparisons = observed.filter((call) => call.command.endsWith("/supabase"));
  assert.equal(comparisons.length, 1);
  const comparison = comparisons[0], url = new URL(comparison.args[2].slice("--remote=".length));
  assert.deepEqual(comparison.args, ["db", "diff", `--remote=${url.href}`, "--schema", "public,private,auth,storage", "--strict-coverage"]);
  assert.equal(url.hostname, `db.${source}.supabase.co`);
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/postgres");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.equal(url.searchParams.get("sslrootcert"), f.ca);
  assert.equal(comparison.env.PGPASSWORD, "never-in-argv");
  assert.equal(comparison.env.SUPABASE_ACCESS_TOKEN, "");
  assert.equal(comparison.env.SUPABASE_NO_KEYRING, "1");
  assert.deepEqual(Object.keys(comparison.env).filter((key) => key.startsWith("PGSSL")), []);
  for (const call of observed.filter((item) => ["pg_dump", "pg_dumpall", "age"].includes(item.command))) {
    assert.equal(call.env.PGSSLMODE, "verify-full");
    assert.equal(call.env.PGSSLROOTCERT, f.ca);
    assert.equal(call.env.SUPABASE_NO_KEYRING, undefined);
  }
  assert.equal(env.WYP_HOSTED_CA_FILE, f.ca);
});

test("unsafe CA inputs or comparison failures stop before any backup export", (t) => {
  const f = fixture(t), calls = [];
  const run = (command, args, config) => { calls.push({ command, args }); return f.options.run(command, args, config); };
  for (const ca of [undefined, "system", "relative.crt", join(f.parent, "missing.crt")]) {
    assert.throws(() => exportBackup(makeTarget(source, "production"), { ...f.options, env: { ...f.options.env, WYP_HOSTED_CA_FILE: ca },
      state() { throw new Error("CA validation must happen before provider reads"); }, run }), /explicit valid private CA/);
    assert.deepEqual(calls, []);
  }
  assert.throws(() => exportBackup(makeTarget(source, "production"), { ...f.options, run(command, args, config) {
    calls.push({ command, args });
    if (command.endsWith("/supabase")) throw new Error("comparison failed");
    return f.options.run(command, args, config);
  } }), /comparison failed/);
  assert.equal(calls.some((call) => ["pg_dump", "pg_dumpall", "age"].includes(call.command)), false);
  assert.equal(readdirSync(f.parent).some((name) => name.startsWith("backup-")), false);
});

test("unexpected Storage objects prevent claiming a complete YouTube-only backup", (t) => {
  const f = fixture(t);
  let commands = 0;
  assert.throws(() => exportBackup(makeTarget(source, "production"), {
    ...f.options,
    state: () => ({ versions: migrationManifest(f.root).map((row) => row.version), application: true, scenarios: 3, accounts: 1, objects: 1 }),
    run(...args) { commands++; return f.options.run(...args); },
  }), /objects|Storage|storage|YouTube/i);
  assert.equal(commands, 0);
  assert.equal(readdirSync(f.parent).some((name) => name.startsWith("backup-")), false);
});

test("an existing application table without migration history is not an empty restore target", (t) => {
  const f = fixture(t), result = exportBackup(makeTarget(source, "production"), f.options);
  for (const scenarios of [0, 1]) {
    assert.throws(() => restoreIntoDisposableTarget(makeTarget(destination, "preview"), {
      ...f.options, manifestPath: result.manifest, identity: f.identity,
      state: () => ({ versions: [], application: true, scenarios, accounts: 0, objects: 0 }),
    }), /empty|application/);
  }
  assert.deepEqual(f.mutations, []);
});

test("a migration arriving during export invalidates and cleans up that bundle", (t) => {
  const f = fixture(t), versions = migrationManifest(f.root).map((row) => row.version);
  let reads = 0;
  assert.throws(() => exportBackup(makeTarget(source, "production"), {
    ...f.options,
    state: () => ({ versions: reads++ ? [...versions, "20990101000000"] : versions, accounts: 1, objects: 0 }),
  }), /migration|drift|changed/i);
  assert.ok(reads >= 2);
  assert.equal(readdirSync(f.parent).some((name) => name.startsWith("backup-")), false);
});
