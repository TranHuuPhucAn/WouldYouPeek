import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeCreatorVideo,
  getPlaybackAccess,
  getUploadSession,
  listCreatorVideos,
} from "@/lib/client/video-api";
import {
  parsePlaybackAccess,
  parseUploadSession,
  parseVideoAsset,
  parseVideoList,
  validateVideoContinuity,
} from "@/lib/client/video-validation";
import {
  videoSnapshot,
  videoList,
  readyVideo,
  uploadDescriptor,
  VIDEO_ID,
} from "./video-fixtures";
beforeEach(() =>
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"),
);
afterEach(() => vi.unstubAllEnvs());
describe("private recording response validation", () => {
  it("accepts complete video state and paginated library without exposing object keys", () => {
    expect(parseVideoAsset(readyVideo())).toEqual(readyVideo());
    expect(parseVideoList(videoList([videoSnapshot()]))).toEqual(
      videoList([videoSnapshot()]),
    );
    expect(() =>
      parseVideoAsset({ ...videoSnapshot(), objectPath: "private" }),
    ).toThrow();
    expect(() =>
      parseVideoList(videoList([videoSnapshot(), videoSnapshot()])),
    ).toThrow();
  });
  it("rejects incomplete ready states, impossible dimensions, and foreign identity", () => {
    expect(() => parseVideoAsset(videoSnapshot({ state: "ready" }))).toThrow();
    expect(() =>
      parseVideoAsset({
        ...readyVideo(),
        metadata: { ...readyVideo().metadata, width: 9999 },
      }),
    ).toThrow();
    expect(() =>
      parseVideoAsset(videoSnapshot(), "82300000-0000-4000-8000-000000000099"),
    ).toThrow();
    expect(() =>
      validateVideoContinuity(videoSnapshot({ revision: 0 }), videoSnapshot()),
    ).toThrow();
    expect(() =>
      validateVideoContinuity(
        videoSnapshot({ contentFingerprint: "b".repeat(64) }),
        videoSnapshot(),
      ),
    ).toThrow();
  });
  it("confines TUS descriptors to the reserved asset and configured origin", () => {
    const body = { video: videoSnapshot(), upload: uploadDescriptor() };
    expect(parseUploadSession(body, VIDEO_ID)).toEqual(body);
    for (const patch of [
      { uploadUrl: "https://evil.test/storage/v1/upload/resumable/x" },
      { objectPath: "another/source.mp4" },
      { byteSize: 99 },
      { uploadUrl: `${uploadDescriptor().uploadUrl}?token=private` },
    ])
      expect(() =>
        parseUploadSession(
          { ...body, upload: { ...body.upload, ...patch } },
          VIDEO_ID,
        ),
      ).toThrow();
  });
  it("rejects signed URL redirects, wrong assets, non-Storage URLs and extra fields", () => {
    const body = {
      assetId: VIDEO_ID,
      expiresAt: "2026-12-01T12:00:00Z",
      url: `http://127.0.0.1:54321/storage/v1/object/sign/creator-vods/owner/${VIDEO_ID}/source.mp4?token=test`,
    };
    expect(parsePlaybackAccess(body, VIDEO_ID)).toEqual(body);
    for (const patch of [
      { url: body.url.replace("127.0.0.1:54321", "evil.test") },
      { url: body.url.replace(VIDEO_ID, "other") },
      { url: "javascript:alert(1)" },
      { secret: "token" },
    ])
      expect(() =>
        parsePlaybackAccess({ ...body, ...patch }, VIDEO_ID),
      ).toThrow();
  });
  it("uses authenticated no-store commands with exact playback context and stable request IDs", async () => {
    const playback = {
      assetId: VIDEO_ID,
      expiresAt: "2026-12-01T12:00:00Z",
      url: `http://127.0.0.1:54321/storage/v1/object/sign/creator-vods/owner/${VIDEO_ID}/source.mp4?token=test`,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(videoList()))
      .mockResolvedValueOnce(
        Response.json({ video: videoSnapshot(), upload: uploadDescriptor() }),
      )
      .mockResolvedValueOnce(
        Response.json({ video: videoSnapshot(), replayed: true }),
      )
      .mockResolvedValueOnce(Response.json(playback));
    vi.stubGlobal("fetch", fetcher);
    await listCreatorVideos();
    await getUploadSession(VIDEO_ID);
    await completeCreatorVideo(VIDEO_ID, {
      requestId: VIDEO_ID,
      expectedRevision: 1,
    });
    await getPlaybackAccess(
      { kind: "library-scenario", scenarioId: VIDEO_ID },
      VIDEO_ID,
    );
    expect(
      fetcher.mock.calls.every((call) => call[1].cache === "no-store"),
    ).toBe(true);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({});
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      requestId: VIDEO_ID,
      expectedRevision: 1,
    });
    expect(JSON.parse(fetcher.mock.calls[3][1].body)).toEqual({
      kind: "library-scenario",
      scenarioId: VIDEO_ID,
    });
  });
});
