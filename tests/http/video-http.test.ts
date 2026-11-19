import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  VideoAssetSnapshot,
  VideoListResponse,
  VideoMutationResponse,
  VideoUploadSessionResponse,
  PlaybackAccess,
} from "@/contracts/video";
import type { TestUser } from "../integration/helpers/test-users";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
} from "../integration/helpers/test-users";
import { createVerifiedCreator } from "../integration/helpers/creator-scenarios";
import {
  fixture,
  fingerprint,
  objectPath,
  patchTus,
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
});
