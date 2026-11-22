import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetId,
  ownerId,
  videoRequestId,
  videoSnapshot,
  uploadDescriptor,
} from "./helpers/video";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  uploads: vi.fn(),
  verified: vi.fn(),
  getUploadSession: vi.fn(),
  finishUploadSession: vi.fn(),
  releaseUploadSession: vi.fn(),
  beginDelete: vi.fn(),
  finishDelete: vi.fn(),
  authorizePlayback: vi.fn(),
  getSession: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({
  requireCreator: mocks.guard,
  requireVerifiedUser: mocks.verified,
}));
vi.mock("@/server/video/repository", () => mocks);
vi.mock("@/server/deployment/capabilities", () => ({
  requireUploadsEnabled: mocks.uploads,
}));
vi.mock("@/server/config", () => ({
  getPublicSupabaseConfig: () => ({
    url: "http://127.0.0.1:54321",
    publishableKey: "public-test-key",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getSession: mocks.getSession },
    storage: {
      from: () => ({ remove: mocks.remove, createSignedUrl: mocks.sign }),
    },
  }),
}));
import { getUploadSession, deleteVideo } from "@/server/video/service";
import { issuePlaybackUrl } from "@/server/video/playback";
const origin = "http://127.0.0.1:54321";
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.guard.mockResolvedValue({});
  mocks.verified.mockResolvedValue({});
  mocks.uploads.mockResolvedValue(undefined);
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: "caller-session" } },
    error: null,
  });
  mocks.releaseUploadSession.mockResolvedValue(true);
  vi.stubGlobal("fetch", mocks.fetch);
});
describe("server-owned resumable sessions", () => {
  it("creates one empty session with the authenticated creator and fixed reserved object", async () => {
    const upload = uploadDescriptor();
    mocks.getUploadSession.mockResolvedValue({
      video: videoSnapshot(),
      upload: { ...upload, uploadUrl: null },
      initializationFence: videoRequestId,
    });
    mocks.fetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { Location: upload.uploadUrl },
      }),
    );
    mocks.finishUploadSession.mockResolvedValue({
      video: videoSnapshot(),
      upload,
    });
    const result = await getUploadSession(assetId, {});
    expect(result.upload.uploadUrl).toBe(upload.uploadUrl);
    expect(mocks.fetch).toHaveBeenCalledWith(
      `${origin}/storage/v1/upload/resumable`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer caller-session",
          "Upload-Length": "100",
          "x-upsert": "false",
        }),
        redirect: "error",
      }),
    );
    const request = mocks.fetch.mock.calls[0][1];
    expect(request).not.toHaveProperty("body");
    expect(request.headers["Upload-Metadata"]).toContain(
      Buffer.from(upload.objectPath).toString("base64"),
    );
    expect(mocks.finishUploadSession).toHaveBeenCalledWith(
      assetId,
      videoRequestId,
      upload.uploadUrl,
    );
  });
  it("recovers the persisted session without creating another or accepting a client URL", async () => {
    mocks.getUploadSession.mockResolvedValue({
      video: videoSnapshot(),
      upload: uploadDescriptor(),
      initializationFence: null,
    });
    await getUploadSession(assetId, {});
    expect(mocks.fetch).not.toHaveBeenCalled();
    await expect(
      getUploadSession(assetId, { uploadUrl: "https://foreign.test" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("releases the initialization lease if Storage redirects to an untrusted URL", async () => {
    mocks.getUploadSession.mockResolvedValue({
      video: videoSnapshot(),
      upload: uploadDescriptor(),
      initializationFence: videoRequestId,
    });
    mocks.fetch.mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: {
          Location: "https://foreign.test/storage/v1/upload/resumable/x",
        },
      }),
    );
    await expect(getUploadSession(assetId, {})).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    expect(mocks.releaseUploadSession).toHaveBeenCalledWith(
      assetId,
      videoRequestId,
    );
    expect(mocks.finishUploadSession).not.toHaveBeenCalled();
  });
  it("does not release quota until actual Storage deletion finishes", async () => {
    mocks.beginDelete.mockResolvedValue({
      video: videoSnapshot({ state: "deleting" }),
      replayed: false,
      object: uploadDescriptor(),
    });
    mocks.remove.mockResolvedValue({ error: { message: "temporary failure" } });
    await expect(
      deleteVideo(assetId, { requestId: videoRequestId, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(mocks.finishDelete).not.toHaveBeenCalled();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.finishDelete.mockResolvedValue({
      video: videoSnapshot({ state: "deleted" }),
      replayed: true,
    });
    expect(
      (
        await deleteVideo(assetId, {
          requestId: videoRequestId,
          expectedRevision: 0,
        })
      ).video.state,
    ).toBe("deleted");
  });
});
describe("signed playback boundary", () => {
  const object = {
    assetId,
    bucket: "creator-vods",
    objectPath: `${ownerId}/${assetId}/source.mp4`,
  };
  it("authorizes the supplied context before requesting a five-minute URL", async () => {
    const context = { kind: "creator-asset", assetId };
    mocks.authorizePlayback.mockResolvedValue(object);
    mocks.sign.mockResolvedValue({
      data: {
        signedUrl: `${origin}/storage/v1/object/sign/${object.bucket}/${object.objectPath}?token=short-lived`,
      },
      error: null,
    });
    const before = Date.now(),
      result = await issuePlaybackUrl(context);
    expect(mocks.authorizePlayback).toHaveBeenCalledWith(context);
    expect(mocks.sign).toHaveBeenCalledWith(object.objectPath, 300);
    expect(Date.parse(result.expiresAt) - before).toBeGreaterThanOrEqual(
      300_000,
    );
    expect(Object.keys(result).sort()).toEqual(["assetId", "expiresAt", "url"]);
  });
  it("fails before signing when context authorization fails", async () => {
    mocks.authorizePlayback.mockRejectedValue(new Error("deny"));
    await expect(
      issuePlaybackUrl({ kind: "creator-asset", assetId }),
    ).rejects.toThrow();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("refuses signed URLs that escape the expected origin or immutable object", async () => {
    mocks.authorizePlayback.mockResolvedValue(object);
    mocks.sign.mockResolvedValue({
      data: { signedUrl: "https://foreign.test/private?token=x" },
      error: null,
    });
    await expect(
      issuePlaybackUrl({ kind: "creator-asset", assetId }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
  });
});

it("rejects disabled uploads before obtaining credentials, storage or transport", async () => {
  mocks.uploads.mockRejectedValue(new Error("Uploads disabled"));
  await expect(getUploadSession(assetId, {})).rejects.toThrow(
    "Uploads disabled",
  );
  await expect(
    deleteVideo(assetId, { requestId: videoRequestId, expectedRevision: 0 }),
  ).rejects.toThrow("Uploads disabled");
  await expect(
    issuePlaybackUrl({
      kind: "creator-draft",
      scenarioId: assetId,
      expectedDraftRevision: 1,
      assetId,
    }),
  ).rejects.toThrow();
  expect(mocks.getUploadSession).not.toHaveBeenCalled();
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
