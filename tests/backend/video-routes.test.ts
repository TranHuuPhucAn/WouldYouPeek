import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetId, videoSnapshot } from "./helpers/video";
const mocks = vi.hoisted(() => ({
  createVideo: vi.fn(),
  listVideos: vi.fn(),
  getVideo: vi.fn(),
  findVideoRequest: vi.fn(),
  getUploadSession: vi.fn(),
  completeUpload: vi.fn(),
  retryValidation: vi.fn(),
  deleteVideo: vi.fn(),
  issuePlaybackUrl: vi.fn(),
}));
vi.mock("@/server/video/service", () => mocks);
vi.mock("@/server/video/playback", () => mocks);
import * as collection from "@/app/api/creator/videos/route";
import { POST as upload } from "@/app/api/creator/videos/[id]/upload-session/route";
import { POST as complete } from "@/app/api/creator/videos/[id]/complete/route";
import { POST as retry } from "@/app/api/creator/videos/[id]/retry-validation/route";
import { POST as remove } from "@/app/api/creator/videos/[id]/delete/route";
import { POST as playback } from "@/app/api/media/playback/route";
const origin = "http://127.0.0.1:3000",
  context = { params: Promise.resolve({ id: assetId }) };
function post(body: unknown, from = origin, path = "/api/creator/videos") {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin: from, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  Object.values(mocks).forEach((mock) =>
    mock
      .mockReset()
      .mockResolvedValue({ video: videoSnapshot(), replayed: false }),
  );
});
describe("media route request boundaries", () => {
  it("requires same-origin JSON for every mutation including signed playback issuance", async () => {
    for (const route of [
      collection.POST,
      upload,
      complete,
      retry,
      remove,
      playback,
    ])
      expect(
        (await route(post({}, "https://foreign.test"), context)).status,
      ).toBe(400);
    for (const mock of Object.values(mocks))
      expect(mock).not.toHaveBeenCalled();
  });
  it("bounds metadata request bytes and rejects unsupported selectors", async () => {
    expect(
      (await collection.POST(post({ bytes: "x".repeat(5000) }))).status,
    ).toBe(413);
    expect(
      (
        await collection.POST(
          post({}, origin, "/api/creator/videos?ownerId=other"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await collection.GET(
          new Request(`${origin}/api/creator/videos?cursor=a&cursor=b`),
        )
      ).status,
    ).toBe(400);
    expect(
      (await playback(post({}, origin, "/api/media/playback?assetId=other")))
        .status,
    ).toBe(400);
    expect(mocks.createVideo).not.toHaveBeenCalled();
    expect(mocks.issuePlaybackUrl).not.toHaveBeenCalled();
  });
  it("keeps private signed capabilities out of browser caches", async () => {
    const response = await playback(post({ kind: "creator-asset", assetId }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.issuePlaybackUrl).toHaveBeenCalledWith({
      kind: "creator-asset",
      assetId,
    });
  });
});
