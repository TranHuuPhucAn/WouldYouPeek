import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rootCertificates } from "node:tls";
import {
  assertDisposableTarget,
  cleanChildEnvironment,
} from "../../scripts/local-target.mjs";
import { assertDockerOwnership } from "../../scripts/local-test-stack.mjs";
import {
  exportBackup,
  restoreIntoDisposableTarget,
  validateBackupManifest,
} from "../../scripts/hosted-backup.mjs";
import { migrationManifest } from "../../scripts/hosted-release.mjs";

const SYNTHETIC_SHA = "a".repeat(40);
const SOURCE_REF = "s".repeat(20);
const RESTORE_REF = "r".repeat(20);
const LEARNER = "de100000-0000-4000-8000-000000000001";
const OPERATOR = "de100000-0000-4000-8000-000000000002";
const LATE_USER = "de100000-0000-4000-8000-000000000003";
const PASSWORD = "Disposable-Recovery-Only-42!";
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const DATABASE_NAME = /^wyp_recovery_(source|target)_[a-f0-9]{20}$/;
const COPY_SCHEMAS = [
  "public",
  "private",
  "auth",
  "storage",
  "extensions",
  "supabase_migrations",
];

/**
 * Real PostgreSQL exports, age encryption and COPY restoration on two databases
 * created inside an already owned disposable container. The adapters MODEL only
 * the hosted transport, Git cleanliness and provider schema-diff response. They
 * never run Supabase remote commands, connect to a provider or read hosted secrets.
 * A restored Auth HTTP login is a separate hosted acceptance gate: SQL verifies
 * the real password hash and application permission/session behavior here.
 */
export function runBackupRestoreRehearsal(env = process.env) {
  const target = assertDisposableTarget(env);
  assertDockerOwnership(target);
  const root = target.workspace;
  const container = `supabase_db_${target.projectId}`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 20);
  const sourceDatabase = `wyp_recovery_source_${suffix}`;
  const restoreDatabase = `wyp_recovery_target_${suffix}`;
  const marker = `wyp-recovery:${target.runId}:${suffix}`;
  const created = new Set();
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), "wyp-local-recovery-")),
  );
  const identity = join(temporary, "identity.agekey");
  const ca = join(temporary, "synthetic CA +#&%.crt");
  const comparisonUrl = new URL(`postgresql://postgres@db.${SOURCE_REF}.supabase.co:5432/postgres`);
  comparisonUrl.searchParams.set("sslmode", "verify-full");
  comparisonUrl.searchParams.set("sslrootcert", ca);
  const safeEnv = cleanChildEnvironment(env);
  // Strip all inherited provider overrides even though no command uses them.
  for (const name of Object.keys(safeEnv))
    if (/^(PG|SUPABASE|WYP_HOSTED|AGE_)/.test(name)) delete safeEnv[name];

  function execute(command, args, input, maxBuffer = 128 * 1024 * 1024) {
    try {
      return execFileSync(command, args, {
        cwd: root,
        env: safeEnv,
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 120_000,
        maxBuffer,
      });
    } catch (error) {
      const stderr = error?.stderr?.toString() ?? "";
      if (stderr.includes("Restore target received data during preparation")) {
        throw new Error("RESTORE_TARGET_CHANGED");
      }
      // Only a bounded primary diagnostic, never the SQL input, data, DETAIL,
      // credentials, stdout or full child-process exception, may escape.
      const primary = stderr.split("\n").find((line) => /^ERROR:/.test(line));
      throw new Error(
        `Local recovery ${command === "docker" ? "database" : "encryption"} operation failed${primary ? `: ${primary.replace(/'[^']*'/g, "'[redacted]'").slice(0, 180)}` : "."}`,
      );
    }
  }

  function docker(command, args, input) {
    assertDockerOwnership(target);
    return execute(
      "docker",
      ["exec", "-i", container, command, ...args],
      input,
    );
  }

  function databaseSql(
    database,
    input,
    { administration = false, platform = false } = {},
  ) {
    if (
      database !== "postgres" &&
      (!DATABASE_NAME.test(database) || !created.has(database))
    )
      throw new Error(
        "Recovery SQL requires a database created by this invocation.",
      );
    if (database === "postgres" && !administration)
      throw new Error("Recovery fixtures cannot write the parent database.");
    if (platform && database === "postgres")
      throw new Error(
        "Platform fixture setup is confined to owned scratch databases.",
      );
    return docker(
      "psql",
      [
        "-U",
        platform ? "supabase_admin" : "postgres",
        "-d",
        database,
        "-X",
        "-Atq",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      input,
    );
  }

  function clusterRoleSnapshot() {
    // Role settings can contain credentials (for example a PostgREST setting).
    // Compare their digest, never the raw settings or masked/password columns.
    return JSON.parse(
      databaseSql(
        "postgres",
        `select jsonb_build_object(
      'roles',(select coalesce(jsonb_agg(jsonb_build_object(
        'name',rolname,'superuser',rolsuper,'inherit',rolinherit,
        'createRole',rolcreaterole,'createDatabase',rolcreatedb,'login',rolcanlogin,
        'replication',rolreplication,'bypassRls',rolbypassrls,
        'connectionLimit',rolconnlimit,'validUntil',rolvaliduntil,
        'configDigest',pg_catalog.md5(coalesce(rolconfig::text,''))
      ) order by rolname),'[]'::jsonb) from pg_roles),
      'memberships',(select coalesce(jsonb_agg(jsonb_build_object(
        'role',r.rolname,'member',m.rolname,'grantor',g.rolname,
        'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option
      ) order by r.rolname,m.rolname,g.rolname),'[]'::jsonb)
        from pg_auth_members a join pg_roles r on r.oid=a.roleid
        join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor)
    );`,
        { administration: true },
      ),
    );
  }

  function createDatabase(database) {
    assert.ok(DATABASE_NAME.test(database));
    assert.equal(created.has(database), false);
    databaseSql(
      "postgres",
      `create database ${identifier(database)} template template0;`,
      { administration: true },
    );
    created.add(database);
    databaseSql(
      "postgres",
      `comment on database ${identifier(database)} is ${literal(marker)};`,
      { administration: true },
    );
  }

  function dropCreatedDatabase(database) {
    if (!created.has(database) || !DATABASE_NAME.test(database))
      throw new Error("Refusing unowned database cleanup.");
    const actual = databaseSql(
      "postgres",
      `select shobj_description(oid,'pg_database') from pg_database where datname=${literal(database)};`,
      { administration: true },
    ).trim();
    if (actual !== marker)
      throw new Error(
        "Recovery database ownership marker changed; cleanup refused.",
      );
    databaseSql(
      "postgres",
      `drop database ${identifier(database)} with (force);`,
      { administration: true },
    );
    created.delete(database);
  }

  const migrations = migrationManifest(root);
  function replayMigrations(database) {
    databaseSql(
      database,
      "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);",
    );
    for (const migration of migrations) {
      const sql = readFileSync(
        join(root, "supabase/migrations", migration.name),
        "utf8",
      );
      databaseSql(
        database,
        `begin;\n${sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(migration.version)},${literal(migration.name)},array[]::text[]);\ncommit;`,
      );
    }
  }

  let baseline;
  let requiredExtensions;

  function readRequiredExtensions() {
    const inventory = JSON.parse(
      databaseSql(
        "postgres",
        `select coalesce(jsonb_agg(jsonb_build_object(
      'name',e.extname,'schema',n.nspname,'version',e.extversion,
      'requires',(select coalesce(jsonb_agg(required.extname order by required.extname),'[]'::jsonb)
        from pg_depend d join pg_extension required on required.oid=d.refobjid
        where d.classid='pg_extension'::regclass and d.objid=e.oid and d.refclassid='pg_extension'::regclass)
    ) order by e.extname),'[]'::jsonb) from pg_extension e join pg_namespace n on n.oid=e.extnamespace;`,
        { administration: true },
      ),
    );
    const byName = new Map(
      inventory.map((extension) => [extension.name, extension]),
    );
    const selected = new Set();
    function include(name) {
      if (selected.has(name)) return;
      const extension = byName.get(name);
      if (!extension)
        throw new Error(
          "A platform extension dependency is absent from its source inventory.",
        );
      selected.add(name);
      extension.requires.forEach(include);
    }
    for (const extension of inventory)
      if (COPY_SCHEMAS.includes(extension.schema)) include(extension.name);
    const ordered = [];
    while (selected.size) {
      const next = [...selected].find((name) =>
        byName
          .get(name)
          .requires.every((dependency) => !selected.has(dependency)),
      );
      if (!next)
        throw new Error("Platform extension dependencies cannot be ordered.");
      ordered.push(byName.get(next));
      selected.delete(next);
    }
    return ordered;
  }

  function prepareExtensions(database) {
    for (const extension of requiredExtensions) {
      const schema =
        extension.schema === "pg_catalog"
          ? ""
          : `create schema if not exists ${identifier(extension.schema)};`;
      databaseSql(
        database,
        `${schema}\ncreate extension if not exists ${identifier(extension.name)} with schema ${identifier(extension.schema)} version ${literal(extension.version)};`,
        { platform: true },
      );
    }
  }

  function preparePlatformBaseline(database) {
    createDatabase(database);
    databaseSql(database, "drop schema public cascade;", { platform: true });
    // A schema-filtered dump omits extension installation/member definitions.
    // Recreate the inspected dependency closure at the source versions and in
    // the original namespaces before any managed or app DDL references it.
    prepareExtensions(database);
    // Schema-only output contains the platform's actual current managed schema,
    // plus app definitions needed to resolve cross-schema triggers/policies.
    // Remove application schemas afterward; canonical migrations must recreate
    // those definitions and their managed-schema hooks during each replay.
    // Only recreating the provider-managed platform fixture needs its local
    // administrator, because the dump contains managed ownership statements.
    // Migrations, application fixtures, exports and restores still use postgres.
    // No membership or elevated privilege is granted to that ordinary role.
    databaseSql(database, baseline, { platform: true });
    databaseSql(
      database,
      // Unlike the other app policies, this one contains only a constant and
      // therefore survives dropping private; remove it before migration replay.
      "drop policy if exists video_rpc_object_read on storage.objects; drop schema if exists private cascade; drop schema public cascade; drop schema if exists supabase_migrations cascade; create schema public authorization postgres; grant usage on schema public to postgres,anon,authenticated,service_role; grant all on schema public to postgres;",
      { platform: true },
    );
    const installed = JSON.parse(
      databaseSql(
        database,
        "select coalesce(jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) order by e.extname),'[]'::jsonb) from pg_extension e join pg_namespace n on n.oid=e.extnamespace;",
      ),
    );
    for (const extension of requiredExtensions) {
      assert.deepEqual(
        installed.find((actual) => actual.name === extension.name),
        {
          name: extension.name,
          schema: extension.schema,
          version: extension.version,
        },
        "Platform cleanup must retain every required extension and its namespace/version",
      );
    }
    assert.equal(
      databaseSql(database, "select count(*) from auth.users;").trim(),
      "0",
    );
    assert.equal(
      databaseSql(database, "select count(*) from storage.objects;").trim(),
      "0",
    );
  }

  const targets = new Map([
    [SOURCE_REF, { database: sourceDatabase, environment: "production" }],
    [RESTORE_REF, { database: restoreDatabase, environment: "preview" }],
  ]);
  const hostedTarget = (projectRef) => ({
    schemaVersion: 1,
    projectRef,
    productionProjectRef: SOURCE_REF,
    environment: targets.get(projectRef).environment,
    appOrigin: "https://recovery.example.com",
    database: {
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      user: "postgres",
      name: "postgres",
    },
  });
  function boundDatabase(value) {
    const known = targets.get(value.projectRef);
    if (
      !known ||
      value.environment !== known.environment ||
      value.database.host !== `db.${value.projectRef}.supabase.co` ||
      !created.has(known.database)
    )
      throw new Error("Unexpected synthetic recovery target.");
    return known.database;
  }

  let injectLateAccount = false;
  const adapters = {
    root,
    env: {
      ...safeEnv,
      WYP_HOSTED_DB_PASSWORD: "synthetic-not-a-provider-password",
      WYP_HOSTED_ACCESS_TOKEN: "synthetic-no-network-access",
      WYP_HOSTED_CA_FILE: ca,
    },
    sql(value, input) {
      return databaseSql(boundDatabase(value), input);
    },
    state(value) {
      const database = boundDatabase(value);
      const state = JSON.parse(
        databaseSql(
          database,
          "select json_build_object('history',to_regclass('supabase_migrations.schema_migrations') is not null,'application',to_regclass('public.scenarios') is not null,'applicationObjects',((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private'))+(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private'))+(select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private'))),'accounts',(select count(*) from auth.users),'objects',(select count(*) from storage.objects));",
        ),
      );
      state.versions = state.history
        ? JSON.parse(
            databaseSql(
              database,
              "select coalesce(json_agg(version order by version),'[]'::json) from supabase_migrations.schema_migrations;",
            ),
          )
        : [];
      state.scenarios = state.application
        ? Number(
            databaseSql(database, "select count(*) from public.scenarios;"),
          )
        : 0;
      return state;
    },
    run(command, args, options = {}) {
      if (command === "git") {
        if (JSON.stringify(args) === JSON.stringify(["rev-parse", "HEAD"]))
          return SYNTHETIC_SHA;
        if (JSON.stringify(args) === JSON.stringify(["status", "--porcelain"]))
          return "";
        throw new Error("Unexpected modeled Git command.");
      }
      if (command === join(root, "node_modules/.bin/supabase")) {
        if (
          JSON.stringify(args) ===
          JSON.stringify([
            "db",
            "diff",
            `--remote=${comparisonUrl.href}`,
            "--schema",
            "public,private,auth,storage",
            "--strict-coverage",
          ])
        ) {
          assert.equal(options.env.PGPASSWORD, "synthetic-not-a-provider-password");
          assert.deepEqual(Object.keys(options.env).filter((name) => name.startsWith("PGSSL")), []);
          assert.equal(options.env.SUPABASE_ACCESS_TOKEN, "");
          return "-- Provider schema-diff check modeled; local schemas use real canonical migration replay.\n";
        }
        if (
          JSON.stringify(args) !==
          JSON.stringify([
            "migration",
            "up",
            `--remote=${RESTORE_REF}`,
            "--yes",
          ])
        )
          throw new Error("Unexpected modeled provider operation.");
        replayMigrations(restoreDatabase);
        if (injectLateAccount)
          databaseSql(
            restoreDatabase,
            `insert into auth.users(id,email,email_confirmed_at) values(${literal(LATE_USER)},'late-recovery-fixture@example.test',now());`,
          );
        return "";
      }
      if (command === "pg_dump" || command === "pg_dumpall") {
        if (args.length === 1 && args[0] === "--version")
          return docker(command, args);
        const ref = [...targets.keys()].find(
          (candidate) => options.env?.PGHOST === `db.${candidate}.supabase.co`,
        );
        if (
          !ref ||
          ref !== SOURCE_REF ||
          args.some((arg) =>
            /^(--host|--port|--username|--dbname|--file|-h$|-p$|-U$|-d$|-f$)/.test(
              arg,
            ),
          )
        )
          throw new Error(
            "Dump command cannot override its local synthetic target.",
          );
        if (command === "pg_dumpall")
          return docker(command, ["-U", "postgres", ...args]);
        return docker(command, [
          "-U",
          "postgres",
          "-d",
          sourceDatabase,
          ...args,
        ]);
      }
      if (command === "age")
        return execute(command, args, options.input, options.maxBuffer);
      throw new Error("Recovery rehearsal refused an unrecognized executable.");
    },
  };

  let rolesBefore;
  let result;
  try {
    const now = Date.now(), pem = rootCertificates.find((value) => {
      const certificate = new X509Certificate(value);
      return certificate.ca && Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo);
    });
    assert.ok(pem, "Node provides a current public CA for an isolated fixture");
    writeFileSync(ca, pem, { mode: 0o600 });
    rolesBefore = clusterRoleSnapshot();
    execute("age-keygen", ["-o", identity]);
    const recipient = execute("age-keygen", ["-y", identity]).trim();
    requiredExtensions = readRequiredExtensions();
    baseline = docker("pg_dump", [
      "-U",
      "postgres",
      "-d",
      "postgres",
      "--schema-only",
      ...COPY_SCHEMAS.map((schema) => `--schema=${schema}`),
    ]);
    // Extensions need their namespaces first. Keep the dump's ALTER OWNER and
    // ACL statements, making only namespace creation idempotent for that setup.
    baseline = baseline.replace(
      /^CREATE SCHEMA ("(?:[^"]|"")*"|[a-z_][a-z0-9_]*);$/gm,
      "CREATE SCHEMA IF NOT EXISTS $1;",
    );
    preparePlatformBaseline(sourceDatabase);
    preparePlatformBaseline(restoreDatabase);
    replayMigrations(sourceDatabase);
    databaseSql(
      sourceDatabase,
      readFileSync(join(root, "supabase/seed.sql"), "utf8"),
    );
    databaseSql(
      sourceDatabase,
      `begin;
      insert into auth.users(id,email,encrypted_password,email_confirmed_at,aud,role,raw_app_meta_data,raw_user_meta_data)
      values (${literal(LEARNER)},'learner-recovery-fixture@example.test',extensions.crypt(${literal(PASSWORD)},extensions.gen_salt('bf')),now(),'authenticated','authenticated','{"provider":"email","providers":["email"]}','{}'),
             (${literal(OPERATOR)},'operator-recovery-fixture@example.test',extensions.crypt(${literal(PASSWORD)},extensions.gen_salt('bf')),now(),'authenticated','authenticated','{"provider":"email","providers":["email"]}','{}');
      insert into auth.identities(provider_id,user_id,identity_data,provider)
      values (${literal(LEARNER)},${literal(LEARNER)},jsonb_build_object('sub',${literal(LEARNER)},'email','learner-recovery-fixture@example.test'),'email');
      insert into private.operator_memberships(user_id) values(${literal(OPERATOR)});
      select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: LEARNER, role: "authenticated" }))},true);
      do $fixture$ declare s jsonb; item jsonb; report jsonb; begin
        s:=public.start_playlist_training_session(gen_random_uuid(),'7ecf3523-18cb-5cbe-a307-5b5cd43d1836','2e061c34-3f9c-58cd-8923-926b353662fc')->'session';
        item:=s->'items'->0;
        s:=public.submit_session_answer((s->>'id')::uuid,(item->>'id')::uuid,item->'challenge'->'options'->0->>'id',gen_random_uuid(),(s->>'revision')::integer)->'session';
        s:=public.end_training_session((s->>'id')::uuid,gen_random_uuid(),(s->>'revision')::integer)->'session';
        report:=public.create_scenario_report(gen_random_uuid(),jsonb_build_object('kind','session-item','sessionId',s->>'id','itemId',item->>'id'),'analysis_issue','Synthetic encrypted-recovery fixture.');
        if s->>'phase'<>'ended' or report->'report'->>'id' is null then raise exception 'Recovery fixture creation failed'; end if;
      end $fixture$;
      select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: OPERATOR, role: "authenticated" }))},true);
      select public.set_operator_scenario_visibility('bind-clove-utility-window',gen_random_uuid(),0,true,'Synthetic recovery visibility hold.');
      commit;`,
    );
    const exported = exportBackup(hostedTarget(SOURCE_REF), {
      ...adapters,
      sha: SYNTHETIC_SHA,
      destination: temporary,
      recipient,
    });
    const manifest = validateBackupManifest(exported.manifest, { root });
    assert.ok(
      manifest.tables.some(
        (table) =>
          table.schema === "auth" &&
          table.table === "users" &&
          table.rows === 2,
      ),
    );
    assert.ok(
      manifest.tables.some(
        (table) =>
          table.schema === "public" &&
          table.table === "attempts" &&
          table.rows === 1,
      ),
    );
    const restored = restoreIntoDisposableTarget(hostedTarget(RESTORE_REF), {
      ...adapters,
      manifestPath: exported.manifest,
      identity,
    });
    assert.equal(restored.data, "verified");
    assert.equal(restored.tables, manifest.tables.length);
    assert.deepEqual(
      adapters.state(hostedTarget(RESTORE_REF)).versions,
      migrations.map((migration) => migration.version),
    );
    databaseSql(
      restoreDatabase,
      `begin;
      do $verify$ begin
        if not exists(select 1 from auth.users where id=${literal(LEARNER)} and encrypted_password=extensions.crypt(${literal(PASSWORD)},encrypted_password)) then raise exception 'Restored bcrypt password does not verify'; end if;
        if (select count(*) from public.training_sessions where user_id=${literal(LEARNER)} and phase='ended')<>1 then raise exception 'Ended session was not restored'; end if;
        if (select count(*) from public.training_session_items where user_id=${literal(LEARNER)})<>3 then raise exception 'Playlist item order snapshot was not restored'; end if;
        if (select count(*) from public.attempts where user_id=${literal(LEARNER)})<>1 then raise exception 'Saved answer was not restored'; end if;
        if (select count(*) from private.scenario_reports)<>1 or not exists(select 1 from private.scenario_visibility where scenario_id='bind-clove-utility-window' and hidden) then raise exception 'Reports or hold were not restored'; end if;
        if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created' and tgenabled='O') then raise exception 'New-account synchronization trigger was not restored'; end if;
        if has_table_privilege('authenticated','private.scenario_answer_keys','SELECT') or has_table_privilege('authenticated','private.operator_memberships','INSERT') then raise exception 'Restored browser permissions broadened'; end if;
        if not has_function_privilege('authenticated','public.get_training_session(uuid)','EXECUTE') then raise exception 'Restored session RPC grant is missing'; end if;
        if public.get_application_capabilities() is distinct from '{"sourceMode":"youtube-only"}'::jsonb then raise exception 'Restored uploads were enabled'; end if;
      end $verify$;
      set local role authenticated;
      select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: OPERATOR, role: "authenticated" }))},true);
      do $ownership$ begin
        if exists(select 1 from public.training_sessions) or exists(select 1 from public.attempts) then raise exception 'Restored RLS exposed another learner history'; end if;
        if not public.get_operator_access() then raise exception 'Restored operator membership is unavailable'; end if;
      end $ownership$;
      select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: LEARNER, role: "authenticated" }))},true);
      do $learner$ declare session_id uuid; snapshot jsonb; begin
        if public.get_operator_access() then raise exception 'Learner gained restored operator access'; end if;
        select id into session_id from public.training_sessions limit 1;
        snapshot:=public.get_training_session(session_id);
        if snapshot->>'phase' is distinct from 'ended' or jsonb_array_length(snapshot->'items') is distinct from 3 or snapshot->'items'->0->'answer' is null or snapshot->'items'->0->'answer'='null'::jsonb then raise exception 'Restored saved review is not usable'; end if;
      end $learner$;
      rollback;`,
    );

    // A new account arriving after the initial empty-target check must survive
    // the transactional lock/recheck. It must never be erased by TRUNCATE.
    dropCreatedDatabase(restoreDatabase);
    preparePlatformBaseline(restoreDatabase);
    injectLateAccount = true;
    assert.throws(
      () =>
        restoreIntoDisposableTarget(hostedTarget(RESTORE_REF), {
          ...adapters,
          manifestPath: exported.manifest,
          identity,
        }),
      /RESTORE_TARGET_CHANGED/,
    );
    assert.equal(
      databaseSql(
        restoreDatabase,
        `select count(*) from auth.users where id=${literal(LATE_USER)};`,
      ).trim(),
      "1",
    );
    assert.equal(
      databaseSql(
        restoreDatabase,
        `select count(*) from auth.users where id=${literal(LEARNER)};`,
      ).trim(),
      "0",
    );
    assert.equal(
      databaseSql(
        restoreDatabase,
        "select count(*) from public.scenarios;",
      ).trim(),
      "0",
    );
    result = {
      encryptedFiles: 4,
      restoredTables: manifest.tables.length,
      passwordHash: "verified",
      permissionsAndHistory: "verified",
      populatedTargetRace: "preserved",
      parentClusterRolesAndGrants: "unchanged",
      hostedTransportAndAuthHttp: "not exercised; requires hosted acceptance",
    };
  } finally {
    // Only names created and marker-checked by this invocation can be removed.
    // Never stop the retained parent stack or touch its postgres database data.
    const failures = [];
    for (const database of [...created].reverse()) {
      try {
        dropCreatedDatabase(database);
      } catch (error) {
        failures.push(error);
      }
    }
    rmSync(temporary, { recursive: true, force: true });
    if (rolesBefore) {
      assert.deepEqual(
        clusterRoleSnapshot(),
        rolesBefore,
        "Recovery migration replay must preserve parent-cluster role flags, settings and every membership option",
      );
    }
    if (failures.length)
      throw new Error(
        "Recovery rehearsal cleanup refused or failed for its owned temporary databases; inspect the retained test stack.",
      );
  }
  console.log(
    `[verify] Local encrypted PostgreSQL backup/restore passed: ${JSON.stringify(result)}`,
  );
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runBackupRestoreRehearsal();
