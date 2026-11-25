import type { VideoAssetSnapshot } from "@/contracts/video";
export const assetId = "11111111-1111-4111-8111-111111111111";
export const ownerId = "22222222-2222-4222-8222-222222222222";
export const videoRequestId = "33333333-3333-4333-8333-333333333333";
export function videoSnapshot(
  overrides: Partial<VideoAssetSnapshot> = {},
): VideoAssetSnapshot {
  return {
    id: assetId,
    revision: 0,
    fileName: "recording.mp4",
    contentFingerprint: "a".repeat(64),
    state: "pending_upload",
    byteSize: 100,
    actualByteSize: null,
    metadata: null,
    failure: null,
    uploadExpiresAt: "2026-11-21T00:00:00Z",
    createdAt: "2026-11-20T00:00:00Z",
    updatedAt: "2026-11-20T00:00:00Z",
    canDelete: true,
    ...overrides,
  };
}
export function uploadDescriptor() {
  return {
    assetId,
    bucket: "creator-vods",
    objectPath: `${ownerId}/${assetId}/source.mp4`,
    uploadUrl: "http://127.0.0.1:54321/storage/v1/upload/resumable/opaque",
    expiresAt: "2026-11-21T00:00:00Z",
    byteSize: 100,
    mimeType: "video/mp4",
  };
}
