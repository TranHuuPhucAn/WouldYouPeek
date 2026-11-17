import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = resolve(root, "node_modules/.bin/supabase");
const command = process.argv[2];
if (process.argv.length !== 3)
  throw new Error(
    "Use the documented npm script without extra arguments. These commands only target local services.",
  );

function run(args) {
  return execFileSync(cli, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 20 * 1024 * 1024,
  });
}
function localUrl(value, port) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Expected a local service on port ${port}. Hosted targets are refused.`,
    );
  }
  return url.origin;
}
function status() {
  const data = JSON.parse(run(["status", "-o", "json"]));
  localUrl(data.API_URL, "54321");
  return data;
}

try {
  switch (command) {
    case "start":
      run(["start"]);
      console.log(
        "Local Supabase started. Run npm run db:env to configure the app.",
      );
      break;
    case "stop":
      run(["stop"]);
      console.log("Local Supabase stopped; database volumes retained.");
      break;
    case "reset":
      status();
      run(["db", "reset", "--yes"]);
      console.log("Disposable local database reset and demo scenarios seeded.");
      break;
    case "env": {
      const data = status();
      const key = data.PUBLISHABLE_KEY || data.ANON_KEY;
      if (typeof key !== "string" || !key)
        throw new Error("Local publishable key is unavailable.");
      const file = resolve(root, ".env.local");
      // Preserve other local settings when regenerating connection information.
      let lines = [];
      try {
        lines = readFileSync(file, "utf8")
          .split("\n")
          .filter(
            (line) =>
              !/^NEXT_PUBLIC_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|APP_URL)=/.test(
                line,
              ),
          );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const values = [
        `NEXT_PUBLIC_SUPABASE_URL=${data.API_URL}`,
        `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${key}`,
        "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000",
      ];
      writeFileSync(
        file,
        [...lines.filter(Boolean), ...values, ""].join("\n"),
        { mode: 0o600 },
      );
      console.log(
        "Wrote ignored .env.local using only local public connection values. No administrator key was written.",
      );
      break;
    }
    case "types":
    case "types-check": {
      status();
      const types = run([
        "gen",
        "types",
        "--lang",
        "typescript",
        "--schema",
        "public",
      ]);
      if (!types.includes("export type Database"))
        throw new Error("Type generation did not return a database schema.");
      const file = resolve(root, "src/types/database.ts");
      if (command === "types-check") {
        if (readFileSync(file, "utf8") !== types)
          throw new Error(
            "Generated database types changed. Run npm run db:types and review the diff.",
          );
        console.log("Generated database types match.");
      } else {
        mkdirSync(resolve(root, "src/types"), { recursive: true });
        writeFileSync(file, types);
        console.log("Generated src/types/database.ts from the local database.");
      }
      break;
    }
    case "test-db":
      status();
      console.log(run(["test", "db"]));
      break;
    case "integration":
    case "http": {
      const data = status();
      const mailUrl = localUrl(data.MAILPIT_URL || data.INBUCKET_URL, "54324");
      const env = {
        ...process.env,
        SUPABASE_TEST_URL: data.API_URL,
        SUPABASE_TEST_PUBLISHABLE_KEY: data.PUBLISHABLE_KEY || data.ANON_KEY,
        SUPABASE_TEST_SERVICE_ROLE_KEY: data.SERVICE_ROLE_KEY,
        SUPABASE_TEST_MAIL_URL: mailUrl,
        SUPABASE_TEST_APP_URL: "http://127.0.0.1:3000",
      };
      if (!env.SUPABASE_TEST_SERVICE_ROLE_KEY)
        throw new Error("Local test administrator key unavailable.");
      execFileSync(
        resolve(root, "node_modules/.bin/vitest"),
        ["run", "--project", command],
        { cwd: root, env, stdio: "inherit" },
      );
      break;
    }
    default:
      throw new Error("Unknown local Supabase command.");
  }
} catch (error) {
  // Child-process errors can contain status output with local credentials. Do not print them.
  console.error(
    typeof error.status === "number"
      ? `Local ${command} command failed (exit ${error.status}). See service output above.`
      : error.message,
  );
  process.exitCode = 1;
}
