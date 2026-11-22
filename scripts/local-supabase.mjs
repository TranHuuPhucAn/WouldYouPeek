import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cleanChildEnvironment, configureLocalCapabilities, localUrl, readLocalProject, TEST_APP_ORIGIN } from "./local-target.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const commands = new Set(["start", "stop", "reset", "migrate", "env", "types", "types-check", "test-db", "integration", "http"]);

export function parseLocalCommand(args) {
  if (args.length !== 1 || !commands.has(args[0])) {
    throw new Error("Use the documented npm script without extra arguments. These commands only target local services.");
  }
  return args[0];
}

export function runLocalCommand(command, {
  root = defaultRoot, env = process.env, execute = execFileSync, log = console.log,
} = {}) {
  parseLocalCommand([command]);
  const target = readLocalProject(root);
  const cli = resolve(root, "node_modules/.bin/supabase");
  const cleanEnv = cleanChildEnvironment(env);
  const run = (args) => execute(cli, args, {
    cwd: root, env: cleanEnv, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 20 * 1024 * 1024,
  });
  const status = () => {
    const data = JSON.parse(run(["status", "-o", "json"]));
    localUrl(data.API_URL, target.ports.api);
    return data;
  };
  const requireDisposable = () => {
    if (!target.disposable) throw new Error("Use npm run test:ci. Database/publication tests only run in the owned disposable project.");
  };

  switch (command) {
    case "start":
      run(["start"]);
      configureLocalCapabilities(root, { execute, env: cleanEnv });
      log("Local Supabase started. Run npm run db:env to configure the app.");
      return;
    case "stop":
      run(["stop"]);
      log("Local Supabase stopped; database volumes retained.");
      return;
    case "reset":
      status();
      run(["db", "reset", "--yes"]);
      configureLocalCapabilities(root, { execute, env: cleanEnv });
      log("Local database reset and demo scenarios seeded. Previous local records were removed.");
      return;
    case "migrate":
      status();
      run(["migration", "up"]);
      configureLocalCapabilities(root, { execute, env: cleanEnv });
      log("Pending local migrations applied without resetting accounts or sessions.");
      return;
    case "env": {
      const data = status();
      const key = data.PUBLISHABLE_KEY || data.ANON_KEY;
      if (typeof key !== "string" || !key) throw new Error("Local publishable key is unavailable.");
      const file = resolve(root, ".env.local");
      let lines = [];
      try {
        lines = readFileSync(file, "utf8").split("\n").filter((line) => !/^(NEXT_PUBLIC_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|APP_URL)|WYP_(DEPLOYMENT_MODE|RELEASE_ENVIRONMENT|SUPABASE_PROJECT_REF|SUPPORT_EMAIL|TURNSTILE_SITE_KEY)|VERCEL_ENV)=/.test(line));
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      writeFileSync(file, [...lines.filter(Boolean),
        "WYP_DEPLOYMENT_MODE=local",
        `NEXT_PUBLIC_SUPABASE_URL=${data.API_URL}`,
        `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}`,
        `NEXT_PUBLIC_APP_URL=${target.disposable ? TEST_APP_ORIGIN : "http://127.0.0.1:3000"}`, "",
      ].join("\n"), { mode: 0o600 });
      log("Wrote ignored .env.local with public local configuration only.");
      return;
    }
    case "types":
    case "types-check": {
      status();
      const types = run(["gen", "types", "--lang", "typescript", "--schema", "public"]).replace(/[ \t]+$/gm, "");
      if (!types.includes("export type Database")) throw new Error("Type generation did not return a database schema.");
      const file = resolve(root, "src/types/database.ts");
      if (command === "types-check") {
        if (readFileSync(file, "utf8") !== types) throw new Error("Generated database types changed. Run npm run db:types and review the diff.");
        log("Generated database types match.");
      } else {
        mkdirSync(resolve(root, "src/types"), { recursive: true });
        writeFileSync(file, types);
        log("Generated src/types/database.ts from the local database.");
      }
      return;
    }
    case "test-db":
      requireDisposable();
      status();
      // TAP failures are safe diagnostics; status/credential output remains captured.
      execute(cli, ["test", "db"], { cwd: root, env: cleanEnv, stdio: "inherit" });
      return;
    case "integration":
    case "http": {
      requireDisposable();
      const data = status();
      const mailUrl = localUrl(data.MAILPIT_URL || data.INBUCKET_URL, target.ports.mail);
      if (!data.SERVICE_ROLE_KEY) throw new Error("Local test administrator key unavailable.");
      const testEnv = {
        ...cleanEnv,
        WYP_DEPLOYMENT_MODE: "local",
        WYP_TEST_WORKSPACE: target.workspace,
        WYP_TEST_PROJECT_ID: target.projectId,
        WYP_TEST_RUN_ID: target.runId,
        SUPABASE_TEST_URL: data.API_URL,
        SUPABASE_TEST_PUBLISHABLE_KEY: data.PUBLISHABLE_KEY || data.ANON_KEY,
        SUPABASE_TEST_SERVICE_ROLE_KEY: data.SERVICE_ROLE_KEY,
        SUPABASE_TEST_MAIL_URL: mailUrl,
        SUPABASE_TEST_APP_URL: TEST_APP_ORIGIN,
      };
      execute(resolve(root, "node_modules/.bin/vitest"), ["run", "--project", command], { cwd: root, env: testEnv, stdio: "inherit" });
      return;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let command;
  try {
    command = parseLocalCommand(process.argv.slice(2));
    runLocalCommand(command);
  } catch (error) {
    // Child process errors can contain captured credentials. Print only the exit status.
    console.error(typeof error.status === "number"
      ? `Local ${command ?? "database"} command failed (exit ${error.status}). See service output above.`
      : error.message);
    process.exitCode = 1;
  }
}
