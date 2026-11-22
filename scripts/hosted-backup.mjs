import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_ROOT, SHA, PROJECT_REF, outsideCheckout, privateFile, readHostedTarget, hostedEnvironment, runHostedSql, runProtected, parseHostedArguments } from "./hosted-target.mjs";
import { migrationManifest, readDatabaseState } from "./hosted-release.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
export const BACKUP_FILES = ["roles.sql.age", "schema.sql.age", "managed-schema.sql.age", "data.sql.age"];
const EXCLUDED = new Set(["auth.schema_migrations", "storage.migrations", "storage.buckets_vectors", "storage.vector_indexes"]);
const SCHEMAS = ["public", "private", "auth", "storage"];
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** COPY uses one escaped text line per row. Compare sorted row hashes, not dump comments or physical ordering. */
export function copyInventory(sql) {
  const lines = sql.split("\n"), tables = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith("COPY ")) continue;
    const match = /^COPY ([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*) \(([a-z0-9_, "-]+)\) FROM stdin;$/.exec(lines[index]);
    if (!match || !SCHEMAS.includes(match[1]) || EXCLUDED.has(`${match[1]}.${match[2]}`)) throw new Error("Unsupported backup COPY table.");
    const columns = match[3].split(",").map((name) => name.trim().replace(/^"|"$/g, ""));
    if (!columns.length || !columns.every((name) => IDENTIFIER.test(name))) throw new Error("Unsupported backup column.");
    const rows = [];
    while (++index < lines.length && lines[index] !== "\\.") rows.push(lines[index]);
    if (index === lines.length) throw new Error("Truncated backup COPY data.");
    tables.push({ schema: match[1], table: match[2], columns, rows: rows.length, sha256: digest(rows.sort().join("\n")) });
  }
  if (!tables.some((row) => row.schema === "auth" && row.table === "users")
    || !tables.some((row) => row.schema === "private" && row.table === "deployment_settings")
    || !tables.some((row) => row.schema === "public" && row.table === "scenarios")) throw new Error("Backup is missing required account/application data.");
  if (new Set(tables.map((row) => `${row.schema}.${row.table}`)).size !== tables.length) throw new Error("Duplicate backup table.");
  return tables.sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`));
}

export function validateBackupManifest(path, { root = PROJECT_ROOT, target, now = Date.now(), maxAgeMs = Infinity } = {}) {
  const file = privateFile(path, root), directory = resolve(file, "..");
  if ((lstatSync(directory).mode & 0o077) !== 0) throw new Error("Backup directory must be private (chmod 700).");
  const manifest = JSON.parse(readFileSync(file, "utf8")), age = now - Date.parse(manifest.createdAt);
  if (manifest.schemaVersion !== 1 || !PROJECT_REF.test(manifest.projectRef ?? "") || !SHA.test(manifest.sha ?? "")
    || (target && manifest.projectRef !== target.projectRef) || !Number.isFinite(age) || age < 0 || age > maxAgeMs
    || !Array.isArray(manifest.migrations) || !manifest.migrations.length
    || !Array.isArray(manifest.tables) || !manifest.tables.length
    || JSON.stringify(manifest.files?.map((item) => item.name).sort()) !== JSON.stringify([...BACKUP_FILES].sort())) throw new Error("Backup manifest is incomplete, stale or for a different project.");
  for (const item of manifest.files) {
    const encrypted = readFileSync(privateFile(join(directory, item.name), root));
    if (!encrypted.toString("utf8").startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n") || digest(encrypted) !== item.sha256) throw new Error("Encrypted backup integrity check failed.");
  }
  return { ...manifest, directory };
}

export function exportBackup(target, { sha, destination, recipient, root = PROJECT_ROOT, env = process.env,
  run = runProtected, sql = runHostedSql, state = readDatabaseState, now = new Date() } = {}) {
  if (!SHA.test(sha ?? "") || !/^age1[0-9a-z]{58}$/.test(recipient ?? "")) throw new Error("Provide the exact source SHA and an age public recipient.");
  const parent = outsideCheckout(destination, root);
  if (!lstatSync(parent).isDirectory() || (lstatSync(parent).mode & 0o077) !== 0) throw new Error("Backup destination must be a private directory.");
  const database = state(target, { root, env }), migrations = migrationManifest(root);
  if (database.objects !== 0) throw new Error("Hosted backup requires zero Storage objects in every bucket.");
  if (JSON.stringify(database.versions) !== JSON.stringify(migrations.map((row) => row.version))) throw new Error("Backup checkout must match the complete source migration history.");
  sql(target, readFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "utf8"), { root, env });
  const childEnv = hostedEnvironment(target, env);
  if (run("git", ["rev-parse", "HEAD"], { cwd: root }).trim() !== sha || run("git", ["status", "--porcelain"], { cwd: root }).trim()) throw new Error("Backup requires a clean checkout of its recorded source SHA.");
  if (!env.WYP_HOSTED_ACCESS_TOKEN) throw new Error("A scoped access token is required to compare source schema with reviewed migrations.");
  const drift = run(join(root, "node_modules/.bin/supabase"), ["db", "diff", `--remote=${target.projectRef}`, "--schema", "public,private,auth,storage", "--strict-coverage"], { cwd: root, env: childEnv });
  if (drift.replace(/^\s*--.*$/gm, "").trim()) throw new Error("Source schema differs from reviewed migrations; reconcile drift before claiming a restorable backup.");
  run("age", ["--version"], { env: childEnv });
  run("pg_dump", ["--version"], { env: childEnv });
  const directory = join(parent, `backup-${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  try {
    const specs = [
      ["roles.sql.age", "pg_dumpall", ["--roles-only", "--no-role-passwords"]],
      ["schema.sql.age", "pg_dump", ["--schema-only", "--schema=public", "--schema=private"]],
      ["managed-schema.sql.age", "pg_dump", ["--schema-only", "--schema=auth", "--schema=storage"]],
      ["data.sql.age", "pg_dump", ["--data-only", "--no-owner", "--no-privileges", ...SCHEMAS.map((name) => `--schema=${name}`), ...[...EXCLUDED].map((name) => `--exclude-table=${name}`)]],
    ];
    const files = [];
    let tables;
    for (const [name, command, args] of specs) {
      const plaintext = run(command, args, { cwd: root, env: childEnv, maxBuffer: 768 * 1024 * 1024 });
      if (!plaintext.trim()) throw new Error("An expected backup export was empty.");
      if (name === "data.sql.age") tables = copyInventory(plaintext);
      const encrypted = run("age", ["--armor", "--encrypt", "--recipient", recipient], { env: childEnv, input: plaintext, maxBuffer: 1024 * 1024 * 1024 });
      if (!encrypted.startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n")) throw new Error("Encryption did not produce an age archive.");
      writeFileSync(join(directory, name), encrypted, { mode: 0o600, flag: "wx" });
      files.push({ name, sha256: digest(encrypted) });
    }
    const after = state(target, { root, env });
    if (after.objects !== 0 || JSON.stringify(after.versions) !== JSON.stringify(database.versions)) throw new Error("Source migration/storage state changed during export; backup was discarded.");
    const manifest = { schemaVersion: 1, projectRef: target.projectRef, createdAt: now.toISOString(), sha, migrations, tables, files,
      restoreStrategy: "reviewed-migrations-and-copy-data", providerSettings: "Reconfigure Auth URLs/templates, SMTP, CAPTCHA and credentials separately; no secrets included.",
      storageObjects: "none; hosted YouTube-only invariant" };
    const path = join(directory, "manifest.json");
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    validateBackupManifest(path, { root, target, now: now.getTime() });
    return { manifest: path, encryptedFiles: files.length, restoreRehearsal: "required" };
  } catch (error) {
    // Only remove the newly generated, uniquely owned incomplete export directory.
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function verifyRestoredProject(target, manifest, { sql = runHostedSql, root = PROJECT_ROOT, env = process.env } = {}) {
  sql(target, readFileSync(join(root, "supabase/maintenance/assert_hosted_ready.sql"), "utf8"), { root, env });
  for (const item of manifest.tables) {
    if (!SCHEMAS.includes(item.schema) || !IDENTIFIER.test(item.table) || !Array.isArray(item.columns) || !item.columns.every((name) => IDENTIFIER.test(name))) throw new Error("Invalid restored table inventory.");
    const rows = sql(target, `copy ${item.schema}."${item.table}" (${item.columns.map((name) => `"${name}"`).join(",")}) to stdout;`, { root, env }).replace(/\n$/, "");
    const lines = rows === "" && item.rows === 0 ? [] : rows.split("\n");
    if (lines.length !== item.rows || digest(lines.sort().join("\n")) !== item.sha256) throw new Error(`Restored data does not match the encrypted snapshot: ${item.schema}.${item.table}.`);
  }
  return { data: "verified", tables: manifest.tables.length, authAndPermissions: "complete live acceptance before recovery cutover" };
}

/** Restore only into a separate preview project with no accounts/content; never restore over production. */
export function restoreIntoDisposableTarget(target, { manifestPath, identity, root = PROJECT_ROOT, env = process.env,
  run = runProtected, sql = runHostedSql, state = readDatabaseState } = {}) {
  const manifest = validateBackupManifest(manifestPath, { root });
  if (target.environment !== "preview" || target.projectRef === manifest.projectRef || target.projectRef === target.productionProjectRef) throw new Error("Restore requires a different, disposable preview project.");
  if (JSON.stringify(manifest.migrations) !== JSON.stringify(migrationManifest(root))) throw new Error("Restore requires the exact reviewed migration files from the backup.");
  const key = privateFile(identity, root), childEnv = hostedEnvironment(target, env);
  const database = state(target, { root, env });
  if (database.accounts !== 0 || database.objects !== 0 || database.versions.length || database.application === true
    || database.scenarios > 0 || database.applicationObjects > 0) throw new Error("Restore target must be empty, without application schema/migrations/accounts/objects.");
  if (!env.WYP_HOSTED_ACCESS_TOKEN) throw new Error("An explicit scoped access token is required to prepare the empty restore target.");
  // Decrypt and validate all files before the first mutation. Never execute a foreign schema/role dump.
  const decoded = {};
  for (const name of BACKUP_FILES) decoded[name] = run("age", ["--decrypt", "--identity", key], { env: childEnv, input: readFileSync(join(manifest.directory, name), "utf8"), maxBuffer: 768 * 1024 * 1024 });
  const data = decoded["data.sql.age"];
  if (JSON.stringify(copyInventory(data)) !== JSON.stringify(manifest.tables)) throw new Error("Decrypted data inventory does not match its manifest.");
  run(join(root, "node_modules/.bin/supabase"), ["migration", "up", `--remote=${target.projectRef}`, "--yes"], { cwd: root, env: childEnv });
  // Canonical migrations recreate custom roles, grants, policies, auth/storage customizations and history.
  // The schema/role exports are encrypted recovery evidence; managed platform DDL is not replayed blindly.
  const names = manifest.tables.map((row) => `${row.schema}."${row.table}"`).join(",");
  const prepared = `begin; lock table ${names} in access exclusive mode;
do $empty$ begin
 if exists(select 1 from auth.users) or exists(select 1 from public.scenarios) or exists(select 1 from storage.objects) then
  raise exception 'Restore target received data during preparation; no data was replaced';
 end if;
end $empty$;
set local session_replication_role=replica; truncate ${names};\n${data}\ncommit;`;
  sql(target, prepared, { root, env });
  return verifyRestoredProject(target, manifest, { sql, root, env });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseHostedArguments(process.argv.slice(2), ["export", "restore"], ["sha", "destination", "recipient", "manifest", "identity", "confirm"]);
    const target = readHostedTarget(options.target, options.project, options.environment);
    if (options.command === "restore" && options.confirm !== target.projectRef) throw new Error("Restore requires --confirm with the disposable project's reference.");
    const result = options.command === "export" ? exportBackup(target, { sha: options.sha, destination: options.destination, recipient: options.recipient })
      : restoreIntoDisposableTarget(target, { manifestPath: options.manifest, identity: options.identity });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error instanceof SyntaxError ? "Invalid protected backup configuration." : error.message); process.exitCode = 1; }
}
