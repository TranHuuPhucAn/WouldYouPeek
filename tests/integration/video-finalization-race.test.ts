import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { assertDisposableTarget } from "../../scripts/local-target.mjs";
import type {
  VideoAssetSnapshot,
  VideoMutationResponse,
} from "@/contracts/video";
import { createVerifiedCreator, rpc } from "./helpers/creator-scenarios";
import { createLocalTestClient } from "./helpers/local-supabase";
import { cleanupTestUsers } from "./helpers/test-users";
import { objectPath, reserve } from "./helpers/videos";

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Narrow administration is used only to coordinate this disposable SQL race.
 * The inserted object is an explicit metadata fixture, not a claim that any
 * upload bytes exist. Real TUS/Storage and ffprobe tests cover those separately.
 */
function ownedDatabase() {
  const target = assertDisposableTarget(process.env);
  const container = `supabase_db_${target.projectId}`;
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP"])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  const labels = JSON.parse(
    execFileSync(
      "docker",
      ["inspect", container, "--format", "{{json .Config.Labels}}"],
      {
        env,
        cwd: target.workspace,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 16_384,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  if (
    labels?.["com.supabase.cli.project"] !== target.projectId ||
    labels?.["com.supabase.cli.workdir"] !== target.workspace
  )
    throw new Error(
      "Race test refuses a database outside its owned disposable workspace.",
    );
  const args = [
    "exec",
    "-i",
    container,
    "psql",
    "-X",
    "-q",
    "-A",
    "-t",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  const options = { env, cwd: target.workspace };
  function query(sql: string): string {
    return execFileSync("docker", args, {
      ...options,
      input: sql,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 65_536,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }
  async function session() {
    const application = `wyp-media-race-${randomUUID()}`;
    const child = spawn("docker", args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let output = "",
      failed = false,
      exited = false;
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 65_536) failed = true;
    });
    child.stderr.on("data", () => {
      /* No credentials or raw SQL diagnostics in test logs. */
    });
    child.on("error", () => {
      failed = true;
    });
    const closed = new Promise<void>((resolve) =>
      child.once("close", (code) => {
        exited = true;
        if (code !== 0) failed = true;
        resolve();
      }),
    );
    const send = (sql: string) => child.stdin.write(`${sql}\n`);
    async function waitFor(marker: string) {
      const deadline = Date.now() + 10_000;
      while (!output.includes(marker)) {
        if (failed || exited || Date.now() >= deadline)
          throw new Error(`Owned SQL race session did not reach ${marker}.`);
        await delay(20);
      }
    }
    let pid: number | undefined;
    async function close() {
      try {
        // Terminate only the exact backend this helper started, even if a failed
        // assertion left it waiting for a row lock. Closing Docker alone could
        // leave psql running inside the container.
        if (!exited)
          query(
            `select pg_terminate_backend(pid) from pg_stat_activity where ${pid === undefined ? "true" : `pid=${pid}`} and application_name=${literal(application)};`,
          );
      } finally {
        child.stdin.end();
        const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
        try {
          await closed;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    try {
      send(
        `set application_name=${literal(application)}; set statement_timeout='8s'; set idle_in_transaction_session_timeout='15s'; select 'WYP_PID:'||pg_backend_pid()||':WYP_PID_END';`,
      );
      await waitFor("WYP_PID_END");
      pid = Number(output.match(/WYP_PID:(\d+):WYP_PID_END/)?.[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error("Owned SQL process identity is missing.");
    } catch (error) {
      await close();
      throw error;
    }
    return {
      pid,
      application,
      send,
      waitFor,
      has: (marker: string) => output.includes(marker),
      close,
    };
  }
  return { query, session };
}

describe("Storage finalization and reservation deletion", () => {
  it("holds deletion until the admitted object commits, then requires actual absence before releasing quota", async () => {
    const db = ownedDatabase();
    const owner = await createVerifiedCreator();
    const sessions: Awaited<ReturnType<typeof db.session>>[] = [];
    let path: string | undefined;
    try {
      const { video } = await reserve(
        owner,
        Buffer.alloc(32),
        "race-fixture.mp4",
      );
      path = objectPath(owner, video.id);
      const requestId = randomUUID();
      const claims = literal(
        JSON.stringify({ sub: owner.id, role: "authenticated" }),
      );
      const insert = await db.session();
      sessions.push(insert);
      insert.send(`begin; set local role authenticated; select set_config('request.jwt.claims',${claims},true);
        insert into storage.objects(bucket_id,name,metadata,version) values('creator-vods',${literal(path)},'{"size":32,"mimetype":"video/mp4"}','race-fixture-version');
        select 'WYP_INSERT_ADMITTED';`);
      await insert.waitFor("WYP_INSERT_ADMITTED");

      const deletion = await db.session();
      sessions.push(deletion);
      deletion.send(`begin; set local role authenticated; select set_config('request.jwt.claims',${claims},true);
        select public.begin_creator_video_delete(${literal(video.id)}::uuid,${literal(requestId)}::uuid,0);
        commit; select 'WYP_DELETE_COMPLETED';`);
      const deadline = Date.now() + 4000;
      let waitingForLock = false;
      while (Date.now() < deadline && !deletion.has("WYP_DELETE_COMPLETED")) {
        waitingForLock =
          db.query(
            `select coalesce(wait_event_type,'') from pg_stat_activity where pid=${deletion.pid} and application_name=${literal(deletion.application)};`,
          ) === "Lock";
        if (waitingForLock) break;
        await delay(25);
      }
      expect(
        waitingForLock,
        "deletion must wait for the admitted Storage insertion",
      ).toBe(true);
      expect(deletion.has("WYP_DELETE_COMPLETED")).toBe(false);

      insert.send("commit; select 'WYP_INSERT_COMMITTED';");
      await insert.waitFor("WYP_INSERT_COMMITTED");
      await deletion.waitFor("WYP_DELETE_COMPLETED");
      expect(
        (
          await rpc<VideoAssetSnapshot>(owner.client, "get_creator_video", {
            p_asset_id: video.id,
          })
        ).state,
      ).toBe("deleting");
      const premature = await owner.client.rpc("finish_creator_video_delete", {
        p_asset_id: video.id,
        p_request_id: requestId,
      });
      expect(premature.error?.message).toBe("VIDEO_CONFLICT");
      const removal = await owner.client.storage
        .from("creator-vods")
        .remove([path]);
      expect(removal.error).toBeNull();
      const finished = await rpc<VideoMutationResponse>(
        owner.client,
        "finish_creator_video_delete",
        { p_asset_id: video.id, p_request_id: requestId },
      );
      expect(finished.video.state).toBe("deleted");
    } finally {
      const stopped = await Promise.allSettled(
        sessions.map((session) => session.close()),
      );
      try {
        if (path) {
          const cleanup = await createLocalTestClient("admin")
            .storage.from("creator-vods")
            .remove([path]);
          if (cleanup.error)
            throw new Error(
              "Could not remove the owned race metadata fixture through Storage.",
            );
        }
        if (stopped.some((result) => result.status === "rejected"))
          throw new Error("Could not close an owned SQL race session.");
      } finally {
        await cleanupTestUsers([owner]);
      }
    }
  });
});
