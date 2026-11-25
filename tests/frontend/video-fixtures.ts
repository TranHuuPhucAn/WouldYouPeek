import type { VideoAssetSnapshot, VideoListResponse } from "@/contracts/video";
import { VIDEO_LIMITS } from "@/lib/video/upload-policy";
export const VIDEO_ID = "82300000-0000-4000-8000-000000000001";
export const OWNER_ID = "82300000-0000-4000-8000-000000000002";
export const videoSnapshot = (
  patch: Partial<VideoAssetSnapshot> = {},
): VideoAssetSnapshot => ({
  id: VIDEO_ID,
  revision: 1,
  fileName: "recording.mp4",
  contentFingerprint: "a".repeat(64),
  state: "pending_upload",
  byteSize: 6,
  actualByteSize: null,
  metadata: null,
  failure: null,
  uploadExpiresAt: "2026-12-01T12:00:00Z",
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
  canDelete: true,
  ...patch,
});
export const readyVideo = () =>
  videoSnapshot({
    revision: 4,
    state: "ready",
    actualByteSize: 6,
    metadata: {
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
    },
  });
export const videoList = (
  videos: VideoAssetSnapshot[] = [],
): VideoListResponse => ({
  videos,
  nextCursor: null,
  limits: VIDEO_LIMITS,
  validator: { online: true, lastSeenAt: null },
});
export const uploadDescriptor = () => ({
  assetId: VIDEO_ID,
  bucket: "creator-vods" as const,
  objectPath: `${OWNER_ID}/${VIDEO_ID}/source.mp4`,
  endpoint: "http://127.0.0.1:54321/storage/v1/upload/resumable",
  uploadUrl: "http://127.0.0.1:54321/storage/v1/upload/resumable/session-id",
  expiresAt: "2026-12-01T12:00:00Z",
  byteSize: 6,
  mimeType: "video/mp4" as const,
});
