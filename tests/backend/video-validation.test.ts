import { describe, expect, it } from "vitest";
import {
  parseCreateVideo,
  parseEmptyVideoCommand,
  parsePlaybackContext,
  parseVideoCommand,
  parseVideoCursor,
} from "@/server/video/validation";
import {
  toVideoSnapshot,
  toUploadDescriptor,
  toVideoList,
} from "@/server/video/projections";
import { databaseError } from "@/server/http";
import { VIDEO_LIMITS } from "@/lib/video/upload-policy";
import {
  createUploadedSource,
  normalizeDraftContent,
  validateDraftContent,
  validatePublishContent,
} from "@/lib/creator/content";
import { validCreatorContent } from "./helpers/creator";
import {
  assetId,
  videoRequestId,
  videoSnapshot,
  uploadDescriptor,
} from "./helpers/video";

describe("video boundaries", () => {
  const request = {
    requestId: videoRequestId,
    fileName: "recording.mp4",
    byteSize: VIDEO_LIMITS.maxFileBytes,
    mimeType: "video/mp4",
    contentFingerprint: "a".repeat(64),
  };
  it("accepts the exact size limit but rejects spoofed, malformed and oversized reservations", () => {
    expect(parseCreateVideo(request)).toEqual(request);
    for (const delta of [
      { byteSize: 0 },
      { byteSize: VIDEO_LIMITS.maxFileBytes + 1 },
      { byteSize: 1.5 },
      { fileName: "bad.mov" },
      { fileName: "bad\n.mp4" },
      { contentFingerprint: "A".repeat(64) },
      { mimeType: "video/webm" },
      { ownerId: assetId },
      { requestId: "bad" },
    ])
      expect(() => parseCreateVideo({ ...request, ...delta })).toThrow();
  });
  it("rejects unsupported command fields and requires context-bound playback", () => {
    expect(
      parseVideoCommand({ requestId: videoRequestId, expectedRevision: 0 })
        .expectedRevision,
    ).toBe(0);
    for (const revision of [-1, 0.1, NaN, 2 ** 31])
      expect(() =>
        parseVideoCommand({
          requestId: videoRequestId,
          expectedRevision: revision,
        }),
      ).toThrow();
    expect(() =>
      parseEmptyVideoCommand({ uploadUrl: "https://arbitrary.example" }),
    ).toThrow();
    expect(parsePlaybackContext({ kind: "creator-asset", assetId })).toEqual({
      kind: "creator-asset",
      assetId,
    });
    expect(() =>
      parsePlaybackContext({ kind: "creator-asset", assetId, phase: "reveal" }),
    ).toThrow();
    expect(() =>
      parsePlaybackContext({
        kind: "session-item",
        sessionId: assetId,
        itemId: assetId,
        phase: "anything",
      }),
    ).toThrow();
    expect(() => parsePlaybackContext({ kind: "asset", assetId })).toThrow();
  });
  it("validates canonical cursors rather than accepting arbitrary SQL selectors", () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: "2026-11-20T00:00:00Z", id: assetId }),
    ).toString("base64url");
    expect(parseVideoCursor(cursor)).toBe(cursor);
    for (const value of [
      "AA",
      cursor + "=",
      Buffer.from(JSON.stringify({ createdAt: "bad", id: assetId })).toString(
        "base64url",
      ),
    ])
      expect(() => parseVideoCursor(value)).toThrow();
  });
  it("strips storage internals and fails closed for inconsistent trusted metadata", () => {
    expect(
      toVideoSnapshot({
        ...videoSnapshot(),
        objectPath: "secret",
        ownerId: assetId,
      }),
    ).not.toHaveProperty("objectPath");
    expect(() => toVideoSnapshot(videoSnapshot({ state: "ready" }))).toThrow();
    expect(() =>
      toVideoSnapshot(videoSnapshot({ actualByteSize: 101 })),
    ).toThrow();
    const data = {
      videos: [videoSnapshot()],
      nextCursor: null,
      limits: VIDEO_LIMITS,
      validator: { online: false, lastSeenAt: null },
    };
    expect(toVideoList(data).videos).toHaveLength(1);
    expect(() =>
      toVideoList({ ...data, videos: [videoSnapshot(), videoSnapshot()] }),
    ).toThrow();
  });
  it("rejects upload URLs outside the fixed Storage origin and path", () => {
    const descriptor = uploadDescriptor();
    expect(
      toUploadDescriptor(descriptor, "http://127.0.0.1:54321").assetId,
    ).toBe(assetId);
    for (const uploadUrl of [
      "https://attacker.test/storage/v1/upload/resumable/opaque",
      "http://127.0.0.1:54321/storage/v1/upload/resumable/opaque?token=x",
      "http://127.0.0.1:54321/storage/v1/object/private",
    ])
      expect(() =>
        toUploadDescriptor(
          { ...descriptor, uploadUrl },
          "http://127.0.0.1:54321",
        ),
      ).toThrow();
  });
  it("maps only known video database errors without exposing provider details", () => {
    expect(() =>
      databaseError({
        message: "VIDEO_IN_USE",
        details: "private storage path",
      }),
    ).toThrow(expect.objectContaining({ code: "VIDEO_IN_USE" }));
    expect(() =>
      databaseError({ message: "postgres credential=secret" }),
    ).toThrow(expect.objectContaining({ code: "STORAGE_UNAVAILABLE" }));
  });
});
describe("uploaded authoring source", () => {
  it("preserves legacy YouTube JSON while keeping uploaded source fields exact", () => {
    const youtube = validCreatorContent();
    expect(normalizeDraftContent(youtube)).toEqual(youtube);
    const source = youtube.source;
    if (source.kind === "uploaded") throw new Error();
    const { url, ...attribution } = source;
    const content = {
      ...youtube,
      source: {
        ...attribution,
        kind: "uploaded" as const,
        assetId,
        creditUrl: url,
      },
    };
    expect(validateDraftContent(content)).toEqual([]);
    expect(validatePublishContent(content)).toEqual([]);
    expect(normalizeDraftContent(content)).toEqual(content);
    expect(
      validateDraftContent({ ...content, source: { ...content.source, url } }),
    ).not.toEqual([]);
    expect(
      validateDraftContent({
        ...content,
        source: { ...content.source, creditUrl: "javascript:alert(1)" },
      }),
    ).not.toEqual([]);
    expect(
      validatePublishContent({
        ...content,
        source: { ...content.source, assetId: null },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "source.assetId" }),
      ]),
    );
    expect(createUploadedSource()).toMatchObject({
      kind: "uploaded",
      assetId: null,
      creditUrl: "",
    });
  });
});
