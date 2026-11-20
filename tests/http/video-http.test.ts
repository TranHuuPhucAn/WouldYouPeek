import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  VideoAssetSnapshot,
  VideoListResponse,
  VideoMutationResponse,
  VideoUploadSessionResponse,
  PlaybackAccess,
} from "@/contracts/video";
import type {
  CreateSessionResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import type { TestUser } from "../integration/helpers/test-users";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
} from "../integration/helpers/test-users";
import {
  createVerifiedCreator,
  publishScenarioFixture,
} from "../integration/helpers/creator-scenarios";
import {
  fixture,
  fingerprint,
  objectPath,
  patchTus,
  uploadedContent,
  uploadReady,
  waitVideo,
} from "../integration/helpers/videos";
import { createLocalTestClient } from "../integration/helpers/local-supabase";
import { api, loginBrowser, type Browser } from "./helpers/browser";
let owner: TestUser,
  learner: TestUser,
  browser: Browser,
  learnerBrowser: Browser;
const paths: string[] = [];
beforeAll(async () => {
  owner = await createVerifiedCreator();
  learner = await createVerifiedTestUser();
  browser = await loginBrowser(owner);
  learnerBrowser = await loginBrowser(learner);
});
afterAll(async () => {
  if (paths.length)
    await createLocalTestClient("admin")
      .storage.from("creator-vods")
      .remove(paths);
  await cleanupTestUsers([owner, learner].filter(Boolean));
});
describe("uploaded-video HTTP lifecycle", () => {
  it("enforces account/creator/origin/body boundaries before creating reservations", async () => {
    expect((await api(null, "/api/creator/videos")).response.status).toBe(401);
    expect(
      (await api(learnerBrowser, "/api/creator/videos")).response.status,
    ).toBe(403);
    expect(
      (
        await api(
          browser,
          "/api/creator/videos",
          {},
          { headers: { Origin: "https://foreign.test" } },
        )
      ).response.status,
    ).toBe(400);
    expect(
      (await api(browser, "/api/creator/videos", { text: "x".repeat(5000) }))
        .response.status,
    ).toBe(413);
    expect(
      (await api(browser, "/api/creator/videos?ownerId=other")).response.status,
    ).toBe(400);
    expect(
      (
        await api(browser, "/api/media/playback", {
          kind: "asset",
          assetId: randomUUID(),
        })
      ).response.status,
    ).toBe(400);
  });
  it("reserves, uploads, validates, signs and deletes without leaking storage internals", async () => {
    const bytes = await fixture("silent.mp4"),
      request = {
        requestId: randomUUID(),
        fileName: "http-fixture.mp4",
        byteSize: bytes.length,
        mimeType: "video/mp4",
        contentFingerprint: fingerprint(bytes),
      };
    const created = await api<VideoMutationResponse>(
      browser,
      "/api/creator/videos",
      request,
    );
    expect(created.response.status).toBe(200);
    const video = created.data.video;
    paths.push(objectPath(owner, video.id));
    expect(video).not.toHaveProperty("objectPath");
    expect(video).not.toHaveProperty("ownerId");
    const replay = await api<VideoMutationResponse>(
      browser,
      "/api/creator/videos",
      request,
    );
    expect(replay.data.replayed).toBe(true);
    expect(replay.data.video.id).toBe(video.id);
    const recovered = await api<{ video: VideoAssetSnapshot }>(
      browser,
      `/api/creator/videos/requests/${request.requestId}`,
    );
    expect(recovered.data.video.id).toBe(video.id);
    const session = await api<VideoUploadSessionResponse>(
      browser,
      `/api/creator/videos/${video.id}/upload-session`,
      {},
    );
    expect(session.response.status).toBe(200);
    expect(
      (
        await api<VideoUploadSessionResponse>(
          browser,
          `/api/creator/videos/${video.id}/upload-session`,
          {},
        )
      ).data.upload.uploadUrl,
    ).toBe(session.data.upload.uploadUrl);
    await patchTus(owner, session.data.upload.uploadUrl, bytes);
    const complete = await api<VideoMutationResponse>(
      browser,
      `/api/creator/videos/${video.id}/complete`,
      { requestId: randomUUID(), expectedRevision: video.revision },
    );
    expect(complete.response.status).toBe(200);
    const ready = await waitVideo(owner, video.id);
    const list = await api<VideoListResponse>(browser, "/api/creator/videos");
    expect(list.data.videos.find((v) => v.id === video.id)?.state).toBe(
      "ready",
    );
    expect(list.data.validator.online).toBe(true);
    const access = await api<PlaybackAccess>(browser, "/api/media/playback", {
      kind: "creator-asset",
      assetId: video.id,
    });
    expect(access.response.status).toBe(200);
    expect(Date.parse(access.data.expiresAt) - Date.now()).toBeLessThanOrEqual(
      300_000,
    );
    const ranged = await fetch(access.data.url, {
      headers: { Range: "bytes=0-31" },
    });
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(32);
    expect(
      (
        await api(learnerBrowser, "/api/media/playback", {
          kind: "creator-asset",
          assetId: video.id,
        })
      ).response.status,
    ).toBe(403);
    const command = {
      requestId: randomUUID(),
      expectedRevision: ready.revision,
    };
    const deleted = await api<VideoMutationResponse>(
      browser,
      `/api/creator/videos/${video.id}/delete`,
      command,
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.data.video.state).toBe("deleted");
    const again = await api<VideoMutationResponse>(
      browser,
      `/api/creator/videos/${video.id}/delete`,
      command,
    );
    expect(again.data.replayed).toBe(true);
    expect((await fetch(access.data.url)).ok).toBe(false);
  });

  it("replays a completed owned item through signed HTTP media without changing its saved session", async () => {
    // Immutable published fixtures live only in the owned disposable stack;
    // stack disposal cleans these accounts and objects without bypassing guards.
    const savedOwner = await createVerifiedCreator();
    const savedLearner = await createVerifiedTestUser();
    const savedBrowser = await loginBrowser(savedLearner);
    const video = await uploadReady(savedOwner, await fixture());
    const scenario = await publishScenarioFixture(
      savedOwner,
      uploadedContent(video.id),
    );
    const start = await api<CreateSessionResponse>(
      savedBrowser,
      "/api/sessions",
      {
        requestId: randomUUID(),
        target: { kind: "scenario", scenarioId: scenario.id },
      },
    );
    expect(start.response.status).toBe(200);
    let snapshot = start.data.session;
    const item = snapshot.items[0];
    const context = {
      kind: "session-item" as const,
      sessionId: snapshot.id,
      itemId: item.id,
      phase: "setup" as const,
    };
    const setup = await api<PlaybackAccess>(
      savedBrowser,
      "/api/media/playback",
      context,
    );
    expect(setup.response.status).toBe(200);
    expect(setup.data.assetId).toBe(video.id);
    expect(
      (
        await api(savedBrowser, "/api/media/playback", {
          ...context,
          phase: "reveal",
        })
      ).response.status,
    ).toBe(404);

    const answered = await api<SessionMutationResponse>(
      savedBrowser,
      `/api/sessions/${snapshot.id}/items/${item.id}/answer`,
      {
        requestId: randomUUID(),
        expectedRevision: snapshot.revision,
        optionId: item.challenge.options[0].id,
      },
    );
    expect(answered.response.status).toBe(200);
    snapshot = answered.data.session;
    const reveal = await api<PlaybackAccess>(
      savedBrowser,
      "/api/media/playback",
      { ...context, phase: "reveal" },
    );
    expect(reveal.response.status).toBe(200);
    expect(reveal.data.assetId).toBe(video.id);
    const range = await fetch(reveal.data.url, {
      headers: { Range: "bytes=0-31" },
    });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(32);

    const completed = await api<SessionMutationResponse>(
      savedBrowser,
      `/api/sessions/${snapshot.id}/advance`,
      {
        requestId: randomUUID(),
        expectedRevision: snapshot.revision,
        fromItemId: item.id,
      },
    );
    expect(completed.response.status).toBe(200);
    snapshot = completed.data.session;
    expect(snapshot.phase).toBe("completed");
    const reopened = await loginBrowser(savedLearner);
    for (const phase of ["setup", "reveal"] as const) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const playback = await api<PlaybackAccess>(
          reopened,
          "/api/media/playback",
          { ...context, phase },
        );
        expect(playback.response.status).toBe(200);
        expect(Object.keys(playback.data).sort()).toEqual([
          "assetId",
          "expiresAt",
          "url",
        ]);
        expect(playback.data.assetId).toBe(video.id);
        expect(Date.parse(playback.data.expiresAt)).toBeGreaterThan(Date.now());
        expect(
          Date.parse(playback.data.expiresAt) - Date.now(),
        ).toBeLessThanOrEqual(300_000);
        const replay = await fetch(playback.data.url, {
          headers: { Range: "bytes=0-31" },
        });
        expect(replay.status).toBe(206);
        expect((await replay.arrayBuffer()).byteLength).toBe(32);
      }
      expect(
        (await api(null, "/api/media/playback", { ...context, phase })).response
          .status,
      ).toBe(401);
      expect(
        (await api(browser, "/api/media/playback", { ...context, phase }))
          .response.status,
      ).toBe(404);
      expect(
        (
          await api(reopened, "/api/media/playback", {
            ...context,
            phase,
            itemId: randomUUID(),
          })
        ).response.status,
      ).toBe(404);
    }
    const afterReplay = await api<SessionSnapshot>(
      reopened,
      `/api/sessions/${snapshot.id}`,
    );
    expect(afterReplay.response.status).toBe(200);
    expect(afterReplay.data).toEqual(snapshot);
  });
});
