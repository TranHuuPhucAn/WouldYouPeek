import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { fixtureProject } from "./helpers.mjs";
import { readLocalProject } from "../../scripts/local-target.mjs";
import { prepareTestWorkspace } from "../../scripts/local-test-stack.mjs";
import {
  checkMediaPrerequisites,
  MEDIA_CONFIG_FILE,
  mintScopedValidatorToken,
  parseMediaCommand,
  prepareLocalValidator,
  readLocalValidatorConfig,
  startMediaValidator,
  stopMediaValidator,
} from "../../scripts/local-media-worker.mjs";
import { generateVideoFixtures } from "../../scripts/generate-video-fixtures.mjs";

const secret = "test-local-secret-not-production-01234567890123456789";
const localStatus = (port = 54321) => ({
  API_URL: `http://127.0.0.1:${port}`,
  PUBLISHABLE_KEY: "sb_publishable_test",
  JWT_SECRET: secret,
  SERVICE_ROLE_KEY: "administrator-never-handed-to-worker",
});
function fakeExecute(status = localStatus()) {
  return (command, args, options) => {
    if (args[0] === "-version") return "ffprobe version test\n";
    if (command === "docker") {
      const target = readLocalProject(options.cwd);
      if (args[0] === "inspect")
        return JSON.stringify({
          "com.supabase.cli.project": target.projectId,
          "com.supabase.cli.workdir": target.workspace,
        });
      if (args[0] === "exec") return `${target.projectId}\n`;
      throw new Error("Unexpected Docker command in fixture.");
    }
    return JSON.stringify(status);
  };
}
function configure(root, options = {}) {
  return prepareLocalValidator({
    root,
    execute: fakeExecute(),
    log() {},
    ...options,
  });
}

test("only documented media commands are accepted; no arbitrary project overrides", () => {
  for (const command of ["setup", "check", "worker"])
    assert.equal(parseMediaCommand([command]), command);
  for (const args of [
    [],
    ["setup", "--remote"],
    ["worker", "--config", "/secret"],
    ["delete"],
  ])
    assert.throws(() => parseMediaCommand(args));
});

test("scoped credential claims are bounded, correctly signed, and never administrator-scoped", () => {
  const now = 1_800_000_000;
  const token = mintScopedValidatorToken(secret, "would-you-peek", { now });
  const parts = token.split(".");
  const header = JSON.parse(Buffer.from(parts[0], "base64url"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
  assert.equal(header.alg, "HS256");
  assert.equal(claims.role, "wyp_media_validator");
  assert.equal(claims.wyp_project_id, "would-you-peek");
  assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  assert.equal(
    parts[2],
    createHmac("sha256", secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url"),
  );
  assert.throws(() => mintScopedValidatorToken(secret, "production"));
  assert.throws(() => mintScopedValidatorToken("short", "would-you-peek"));
  assert.throws(() =>
    mintScopedValidatorToken(secret, "would-you-peek", {
      lifetimeSeconds: 90_000,
    }),
  );
});

test("setup writes only scoped credentials to an ignored owner-only file without logging secrets", (t) => {
  const root = fixtureProject(t),
    logs = [],
    calls = [];
  const result = configure(root, {
    log(value) {
      logs.push(value);
    },
    execute(command, args, options) {
      calls.push({ command, args, options });
      return fakeExecute()(command, args, options);
    },
  });
  assert.equal(result.configPath, join(realpathSync(root), MEDIA_CONFIG_FILE));
  const contents = readFileSync(result.configPath, "utf8"),
    parsed = JSON.parse(contents);
  assert.equal(statSync(result.configPath).mode & 0o777, 0o600);
  assert.equal(parsed.projectId, "would-you-peek");
  assert.equal(parsed.publishableKey, "sb_publishable_test");
  assert.equal(
    readLocalValidatorConfig({ root }).config.validatorToken,
    parsed.validatorToken,
  );
  for (const output of [contents, JSON.stringify(logs)]) {
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes("administrator-never-handed-to-worker"));
    assert.ok(!output.includes("JWT_SECRET"));
  }
  assert.deepEqual(calls[1].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.match(calls[1].command, /node_modules\/\.bin\/supabase$/);
  assert.deepEqual(calls[1].args, ["status", "-o", "json"]);
  assert.deepEqual(calls[2].args, [
    "inspect",
    "supabase_db_would-you-peek",
    "--format",
    "{{json .Config.Labels}}",
  ]);
  assert.equal(calls[3].command, "docker");
  assert.equal(calls[3].args[2], "supabase_db_would-you-peek");
  assert.ok(calls[3].args.includes("project_id=would-you-peek"));
  assert.match(
    calls[3].options.input,
    /insert into private\.media_validator_identity/,
  );
  assert.match(
    calls[3].options.input,
    /on conflict \(singleton\) do update set project_id = excluded\.project_id/,
  );
  assert.ok(!calls[3].options.input.includes(secret));
});

test("setup refuses wrong projects, remote service status and broad keys before creating credentials", (t) => {
  const root = fixtureProject(t);
  for (const status of [
    { ...localStatus(), API_URL: "https://production.supabase.co" },
    { ...localStatus(), API_URL: "http://localhost:55321" },
    { ...localStatus(), PUBLISHABLE_KEY: "sb_secret_bad" },
    { ...localStatus(), JWT_SECRET: undefined },
  ])
    assert.throws(() => configure(root, { execute: fakeExecute(status) }));
  const config = join(root, "supabase/config.toml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace('"would-you-peek"', '"other-project"'),
  );
  let invoked = false;
  assert.throws(() =>
    configure(root, {
      execute() {
        invoked = true;
      },
    }),
  );
  assert.equal(invoked, false);
});

test("disposable credentials bind the marker project and test ports", (t) => {
  const target = prepareTestWorkspace(fixtureProject(t));
  const calls = [];
  configure(target.workspace, {
    execute(command, args, options) {
      calls.push({ command, args, options });
      return fakeExecute(localStatus(55321))(command, args, options);
    },
  });
  const { config } = readLocalValidatorConfig({ root: target.workspace });
  assert.equal(config.projectId, target.projectId);
  assert.equal(config.apiUrl, "http://127.0.0.1:55321");
  const claims = JSON.parse(
    Buffer.from(config.validatorToken.split(".")[1], "base64url"),
  );
  assert.equal(claims.wyp_project_id, target.projectId);
  const binding = calls.find(
    (call) => call.command === "docker" && call.args[0] === "exec",
  );
  assert.equal(binding.args[2], `supabase_db_${target.projectId}`);
  assert.ok(binding.args.includes(`project_id=${target.projectId}`));
  assert.equal(binding.options.cwd, target.workspace);
});

test("wrong Docker ownership or an unconfirmed project binding cannot mint a worker credential", (t) => {
  const root = fixtureProject(t);
  for (const labels of [
    {
      "com.supabase.cli.project": "another-project",
      "com.supabase.cli.workdir": realpathSync(root),
    },
    {
      "com.supabase.cli.project": "would-you-peek",
      "com.supabase.cli.workdir": "/different/workspace",
    },
  ]) {
    let mutated = false;
    assert.throws(
      () =>
        configure(root, {
          execute(command, args, options) {
            if (command === "docker" && args[0] === "inspect")
              return JSON.stringify(labels);
            if (command === "docker" && args[0] === "exec") mutated = true;
            return fakeExecute()(command, args, options);
          },
        }),
      /ownership/,
    );
    assert.equal(mutated, false);
  }
  assert.throws(
    () =>
      configure(root, {
        execute(command, args, options) {
          if (command === "docker" && args[0] === "exec")
            return "wrong-project\n";
          return fakeExecute()(command, args, options);
        },
      }),
    /confirmed/,
  );
});

test("credential writes reject symlink destinations and missing ffprobe", (t) => {
  const root = fixtureProject(t),
    unrelated = join(root, "keep.txt");
  writeFileSync(unrelated, "do-not-replace");
  symlinkSync(unrelated, join(root, MEDIA_CONFIG_FILE));
  assert.throws(() => configure(root));
  assert.equal(readFileSync(unrelated, "utf8"), "do-not-replace");
  assert.throws(
    () =>
      checkMediaPrerequisites({
        root,
        execute() {
          throw new Error("not installed");
        },
      }),
    /ffprobe/,
  );
});

test("worker launch contains no administrator environment, signing secret or token arguments", (t) => {
  const root = fixtureProject(t);
  configure(root);
  const child = new EventEmitter(),
    calls = [];
  const result = startMediaValidator({
    root,
    env: {
      PATH: "/bin",
      HOME: "/test",
      SUPABASE_SERVICE_ROLE_KEY: "admin",
      SUPABASE_JWT_SECRET: secret,
      WYP_TEST_RUN_ID: "private",
      NODE_OPTIONS: "--require /tmp/untrusted",
      OTHER_SECRET: "secret",
    },
    launch(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });
  assert.equal(result, child);
  assert.deepEqual(calls[0].options.env, { PATH: "/bin", HOME: "/test" });
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [
    "--import",
    "tsx",
    join(realpathSync(root), "src/worker/media/main.ts"),
    "--config",
    join(realpathSync(root), MEDIA_CONFIG_FILE),
  ]);
  assert.ok(!JSON.stringify(calls).includes(secret));
});

test("stop helper only terminates the child it owns", async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    signals: [],
  });
  child.kill = (signal) => {
    child.signals.push(signal);
    queueMicrotask(() => child.emit("exit", 0));
    return true;
  };
  await stopMediaValidator(child);
  assert.deepEqual(child.signals, ["SIGTERM"]);
  child.exitCode = 0;
  await stopMediaValidator(child);
  assert.equal(child.signals.length, 1);
});

test("stop helper escalates only the same stuck child before the outer wrapper deadline", async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    signals: [],
  });
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("exit", null));
    return true;
  };
  await stopMediaValidator(child, { timeoutMs: 1 });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("fixture generator uses only owned synthetic sources and bounded ignored outputs", (t) => {
  const root = fixtureProject(t),
    calls = [];
  const result = generateVideoFixtures({
    root,
    env: { PATH: "/bin", SUPABASE_SERVICE_ROLE_KEY: "not-in-child" },
    execute(command, args, options) {
      calls.push({ command, args, options });
      const path = args.at(-1);
      writeFileSync(
        path,
        Buffer.alloc(path.endsWith("resumable.mp4") ? 13 * 1024 * 1024 : 1024),
      );
    },
  });
  assert.equal(
    result.directory,
    join(realpathSync(root), "test-results/generated-video"),
  );
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.command, "ffmpeg");
    assert.equal(call.options.shell, false);
    assert.ok(call.args.includes("lavfi"));
    assert.ok(call.args.includes("libx264"));
    assert.ok(!call.args.some((arg) => /https?:\/\//.test(arg)));
    assert.deepEqual(call.options.env, {
      PATH: "/bin",
      LANG: "C",
      LC_ALL: "C",
    });
  }
});
