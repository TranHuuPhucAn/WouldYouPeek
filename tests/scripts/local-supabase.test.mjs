import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLocalCommand, runLocalCommand } from "../../scripts/local-supabase.mjs";
import { localUrl, cleanChildEnvironment } from "../../scripts/local-target.mjs";
import { fixtureProject } from "./helpers.mjs";
import { prepareTestWorkspace } from "../../scripts/local-test-stack.mjs";

test("only documented local commands with no target overrides are accepted", () => {
  for (const args of [[], ["migrate", "--remote"], ["reset", "--all"], ["migrate", "--workdir", "/tmp"], ["arbitrary"]]) {
    assert.throws(() => parseLocalCommand(args));
  }
  assert.equal(parseLocalCommand(["migrate"]), "migrate");
});

test("loopback target validation rejects remote, ambiguous and wrong-port endpoints", () => {
  for (const value of ["https://example.supabase.co", "http://127.0.0.1:54321@evil.test", "http://localhost:54322", "https://localhost:54321", "http://127.0.0.1:54321/path", "http://127.0.0.1:54321/?x=1", "http://127.0.0.1:54321/#x"]) {
    assert.throws(() => localUrl(value, 54321));
  }
  assert.equal(localUrl("http://127.0.0.1:54321", 54321), "http://127.0.0.1:54321");
});

test("additive migrate validates the project and status before invoking the local CLI", (t) => {
  const root = fixtureProject(t), calls = [];
  runLocalCommand("migrate", { root, log() {}, execute(command, args, options) {
    calls.push(args);
    assert.equal(options.cwd, root);
    assert.ok(command.endsWith("node_modules/.bin/supabase"));
    return args[0] === "status" ? JSON.stringify({ API_URL: "http://127.0.0.1:54321" }) : "";
  } });
  assert.deepEqual(calls, [["status", "-o", "json"], ["migration", "up"]]);
});

test("a bad status target cannot apply migrations", (t) => {
  const root = fixtureProject(t), calls = [];
  assert.throws(() => runLocalCommand("migrate", { root, execute(command, args) {
    calls.push(args); return JSON.stringify({ API_URL: "https://production.supabase.co" });
  } }));
  assert.equal(calls.length, 1);
});

test("wrong local project identity is rejected before any CLI command", (t) => {
  const root = fixtureProject(t), config = join(root, "supabase/config.toml");
  writeFileSync(config, readFileSync(config, "utf8").replace('"would-you-peek"', '"some-other-project"'));
  let called = false;
  assert.throws(() => runLocalCommand("migrate", { root, execute() { called = true; } }));
  assert.equal(called, false);
});

test("publication/database test commands never target the user's normal project", (t) => {
  const root = fixtureProject(t);
  for (const command of ["integration", "http", "test-db"]) {
    let called = false;
    assert.throws(() => runLocalCommand(command, { root, execute() { called = true; } }), /test:ci/);
    assert.equal(called, false);
  }
});

test("environment output preserves unrelated settings and contains no administrator key", (t) => {
  const root = fixtureProject(t);
  runLocalCommand("env", { root, log() {}, execute() { return JSON.stringify({ API_URL: "http://127.0.0.1:54321", PUBLISHABLE_KEY: "public-placeholder", SERVICE_ROLE_KEY: "private-placeholder" }); } });
  const value = readFileSync(join(root, ".env.local"), "utf8");
  assert.match(value, /PRIVATE_TEST_SENTINEL=do-not-copy/);
  assert.match(value, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=public-placeholder/);
  assert.doesNotMatch(value, /private-placeholder|SERVICE_ROLE_KEY/);
});

test("provider target and credential environment cannot leak into CLI defaults", () => {
  const env = cleanChildEnvironment({ PATH: "/bin", SUPABASE_ACCESS_TOKEN: "secret", SUPABASE_DB_URL: "remote", DATABASE_URL: "remote", PGPASSWORD: "secret", WYP_TEST_WORKSPACE: "other", NEXT_PUBLIC_APP_URL: "wrong" });
  assert.deepEqual(env, { PATH: "/bin" });
});

test("failed database tests expose TAP output while status credentials remain captured", (t) => {
  const target = prepareTestWorkspace(fixtureProject(t)), logs = [];
  assert.throws(() => runLocalCommand("test-db", { root: target.workspace, log: (value) => logs.push(value), execute(command, args, options) {
    if (args[0] === "status") {
      assert.deepEqual(options.stdio, ["ignore", "pipe", "inherit"]);
      return JSON.stringify({ API_URL: "http://127.0.0.1:55321", SERVICE_ROLE_KEY: "private-placeholder" });
    }
    assert.deepEqual(args, ["test", "db"]);
    assert.equal(options.stdio, "inherit");
    throw Object.assign(new Error("TAP failed"), { status: 1 });
  } }), /TAP failed/);
  assert.deepEqual(logs, []);
});
