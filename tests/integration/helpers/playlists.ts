import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect } from "vitest";
import type {
  CreatorScenarioSnapshot,
  CreatorMutationResponse,
} from "@/contracts/creator";
import type {
  CreatorProfile,
  CreatorProfileMutationResponse,
} from "@/contracts/creator-profile";
import type {
  CreatorPlaylistSnapshot,
  PlaylistDraftContent,
  PlaylistMutationResponse,
  PlaylistSelection,
} from "@/contracts/playlist";
import { PLAYLIST_REVIEW_CHECKLIST_KEYS } from "@/contracts/playlist";
import type { CreateSessionResponse } from "@/contracts/session";
import { assertDisposableTarget } from "../../../scripts/local-target.mjs";
import { rpc, reviewDraftFixture } from "./creator-scenarios";
import { getLocalTestConfig } from "./local-supabase";
import type { TestUser } from "./test-users";

export const playlistChecklist = () =>
  Object.fromEntries(PLAYLIST_REVIEW_CHECKLIST_KEYS.map((key) => [key, true]));
export function selected(scenario: CreatorScenarioSnapshot): PlaylistSelection {
  if (!scenario.publication.currentVersion)
    throw new Error("Expected a published scenario fixture.");
  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.publication.currentVersion,
  };
}
export async function saveProfile(
  user: TestUser,
  displayName = "Playlist Test Creator",
  expectedRevision = 0,
) {
  return (
    await rpc<CreatorProfileMutationResponse>(
      user.client,
      "save_creator_profile",
      {
        p_request_id: randomUUID(),
        p_expected_revision: expectedRevision,
        p_display_name: displayName,
      },
    )
  ).profile;
}
export async function createPlaylist(
  user: TestUser,
  items: PlaylistSelection[] = [],
  title = "Ordered decisions",
) {
  const created = await rpc<PlaylistMutationResponse>(
    user.client,
    "create_creator_playlist",
    { p_request_id: randomUUID() },
  );
  return savePlaylist(user, created.playlist, {
    title,
    description: "A mixed-player practice collection.",
    items,
  });
}
export async function savePlaylist(
  user: TestUser,
  playlist: CreatorPlaylistSnapshot,
  content: PlaylistDraftContent,
) {
  return (
    await rpc<PlaylistMutationResponse>(user.client, "save_creator_playlist", {
      p_playlist_id: playlist.id,
      p_request_id: randomUUID(),
      p_expected_revision: playlist.revision,
      p_content: content,
    })
  ).playlist;
}
export async function reviewPlaylist(
  user: TestUser,
  playlist: CreatorPlaylistSnapshot,
  profile?: CreatorProfile,
) {
  const currentProfile =
    profile ?? (await rpc<CreatorProfile>(user.client, "get_creator_profile"));
  return (
    await rpc<PlaylistMutationResponse>(
      user.client,
      "review_creator_playlist",
      {
        p_playlist_id: playlist.id,
        p_request_id: randomUUID(),
        p_expected_revision: playlist.revision,
        p_profile_revision: currentProfile.revision,
        p_checklist: playlistChecklist(),
      },
    )
  ).playlist;
}
export function publishArgs(
  playlist: CreatorPlaylistSnapshot,
  requestId = randomUUID(),
) {
  if (!playlist.review)
    throw new Error("Expected a reviewed playlist fixture.");
  return {
    p_playlist_id: playlist.id,
    p_request_id: requestId,
    p_expected_revision: playlist.revision,
    p_review_id: playlist.review.id,
  };
}
export async function publishReviewed(
  user: TestUser,
  playlist: CreatorPlaylistSnapshot,
) {
  return (
    await rpc<PlaylistMutationResponse>(
      user.client,
      "publish_creator_playlist",
      publishArgs(playlist),
    )
  ).playlist;
}
export async function publishPlaylist(
  user: TestUser,
  items: PlaylistSelection[],
  title = "Ordered decisions",
) {
  return publishReviewed(
    user,
    await reviewPlaylist(user, await createPlaylist(user, items, title)),
  );
}
export async function republishScenario(
  user: TestUser,
  scenario: CreatorScenarioSnapshot,
) {
  const reviewed = await reviewDraftFixture(user, scenario);
  return (
    await rpc<CreatorMutationResponse>(
      user.client,
      "publish_creator_scenario",
      {
        p_scenario_id: reviewed.id,
        p_request_id: randomUUID(),
        p_expected_revision: reviewed.revision,
        p_review_id: reviewed.review!.id,
      },
    )
  ).scenario;
}
export function withdrawalArgs(scenario: CreatorScenarioSnapshot) {
  return {
    p_scenario_id: scenario.id,
    p_request_id: randomUUID(),
    p_expected_revision: scenario.revision,
  };
}
export async function withdrawScenario(
  user: TestUser,
  scenario: CreatorScenarioSnapshot,
) {
  return (
    await rpc<CreatorMutationResponse>(
      user.client,
      "unpublish_creator_scenario",
      withdrawalArgs(scenario),
    )
  ).scenario;
}
export function startArgs(
  playlist: CreatorPlaylistSnapshot,
  requestId = randomUUID(),
) {
  if (!playlist.publication.currentVersion)
    throw new Error("Expected a published playlist fixture.");
  return {
    p_request_id: requestId,
    p_playlist_id: playlist.id,
    p_expected_publication_version: playlist.publication.currentVersion,
  };
}
export async function startPlaylist(
  user: TestUser,
  playlist: CreatorPlaylistSnapshot,
  requestId = randomUUID(),
) {
  return rpc<CreateSessionResponse>(
    user.client,
    "start_playlist_training_session",
    startArgs(playlist, requestId),
  );
}
export function expectMetadataOnly(value: unknown, owner?: TestUser) {
  const denied = new Set([
    "question",
    "options",
    "analysis",
    "observedAction",
    "reveal",
    "ownerId",
    "creatorId",
    "userId",
    "email",
    "assetId",
    "objectPath",
    "storagePath",
    "storageKey",
    "url",
    "startSeconds",
    "pauseSeconds",
    "endSeconds",
  ]);
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      expect(
        denied.has(key),
        `Private field ${key} must not appear in playlist metadata`,
      ).toBe(false);
      visit(child);
    }
  }
  visit(value);
  if (owner) {
    expect(JSON.stringify(value)).not.toContain(owner.id);
    expect(JSON.stringify(value)).not.toContain(owner.email);
  }
}

/** Coordinate real HTTP RPCs behind an observed PostgreSQL lock. No fixture rows
 * are manufactured here: administration only holds/releases a transaction lock
 * and observes its blocking graph in this owned disposable database.
 */
export async function raceBehindLock<T>(
  key: string,
  namespace: number,
  commands: (() => PromiseLike<T>)[],
): Promise<T[]> {
  const target = assertDisposableTarget(process.env);
  getLocalTestConfig();
  const container = `supabase_db_${target.projectId}`;
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP"])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  const options = { cwd: target.workspace, env };
  const labels = JSON.parse(
    execFileSync(
      "docker",
      ["inspect", container, "--format", "{{json .Config.Labels}}"],
      {
        ...options,
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
      "Playlist race refuses a database outside its owned disposable workspace.",
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
  const query = (sql: string) =>
    execFileSync("docker", args, {
      ...options,
      input: sql,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 65_536,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  const child = spawn("docker", args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  const application = `wyp-playlist-race-${randomUUID()}`;
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  let output = "",
    exited = false,
    failed = false;
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    if (output.length > 65_536) failed = true;
  });
  child.stderr.on("data", () => {
    /* Keep raw SQL diagnostics out of test output. */
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
  const pending: Promise<T>[] = [];
  let pid: number | undefined;
  try {
    child.stdin.write(
      `set application_name=${literal(application)}; set statement_timeout='15s'; set idle_in_transaction_session_timeout='20s'; begin; select pg_advisory_xact_lock(hashtextextended(${literal(key)},${namespace})); select 'LOCK_HELD:'||pg_backend_pid()||':END_PID';\n`,
    );
    const deadline = Date.now() + 10_000;
    while (!output.includes(":END_PID")) {
      if (failed || exited || Date.now() >= deadline)
        throw new Error("Owned playlist barrier was not acquired.");
      await delay(20);
    }
    pid = Number(output.match(/LOCK_HELD:(\d+):END_PID/)?.[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error("Owned playlist barrier has no backend identity.");
    for (const command of commands)
      pending.push(Promise.resolve().then(command));
    // Count direct and transitive waiters; a second command may wait on the
    // first command's actor lock while that command waits on our barrier.
    let count = 0;
    while (Date.now() < deadline) {
      count = Number(
        query(
          `with recursive blocked(pid) as (select pid from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join blocked b on b.pid=any(pg_blocking_pids(a.pid))) select count(*) from blocked;`,
        ),
      );
      if (count >= commands.length) break;
      await delay(25);
    }
    expect(
      count,
      "Every competing RPC must reach the database barrier before release",
    ).toBeGreaterThanOrEqual(commands.length);
    child.stdin.end("commit;\n");
    await closed;
    if (failed) throw new Error("Owned playlist barrier did not commit.");
    return await Promise.all(pending);
  } finally {
    if (!exited) {
      try {
        query(
          `select pg_terminate_backend(pid) from pg_stat_activity where application_name=${literal(application)}${pid === undefined ? "" : ` and pid=${pid}`};`,
        );
      } finally {
        child.stdin.end();
        const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
        await closed;
        clearTimeout(timer);
      }
    }
    await Promise.allSettled(pending);
  }
}
