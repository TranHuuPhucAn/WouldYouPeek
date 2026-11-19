import "server-only";
import {
  VIDEO_STATES,
  type VideoAssetSnapshot,
  type VideoListResponse,
  type VideoMutationResponse,
  type VideoMetadata,
  type VideoUploadDescriptor,
} from "@/contracts/video";
import { VIDEO_LIMITS } from "@/lib/video/upload-policy";
import { ApiError } from "@/server/http";
import { UUID_PATTERN } from "@/server/training/validation";
export function invalidVideoData(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Video information could not be loaded safely.",
  );
}
export function videoRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) invalidVideoData();
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 300): string {
  if (typeof v !== "string" || v.length > max) invalidVideoData();
  return v;
}
function id(v: unknown): string {
  const s = text(v, 36);
  if (!UUID_PATTERN.test(s)) invalidVideoData();
  return s;
}
function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max)
    invalidVideoData();
  return v;
}
function date(v: unknown): string {
  const s = text(v, 60);
  if (!Number.isFinite(Date.parse(s))) invalidVideoData();
  return s;
}
function boolean(v: unknown): boolean {
  if (typeof v !== "boolean") invalidVideoData();
  return v;
}
function metadata(v: unknown): VideoMetadata | null {
  if (v === null) return null;
  const m = videoRecord(v);
  if (
    typeof m.durationSeconds !== "number" ||
    !Number.isFinite(m.durationSeconds) ||
    m.durationSeconds <= 0 ||
    m.durationSeconds > VIDEO_LIMITS.maxDurationSeconds ||
    m.videoCodec !== "h264" ||
    m.pixelFormat !== "yuv420p" ||
    (m.audioCodec !== "aac" && m.audioCodec !== null)
  )
    invalidVideoData();
  const width = integer(m.width, 1920),
    height = integer(m.height, 1080);
  if (!width || !height) invalidVideoData();
  return {
    durationSeconds: m.durationSeconds,
    width,
    height,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: m.audioCodec,
  };
}
export function toVideoSnapshot(value: unknown): VideoAssetSnapshot {
  const v = videoRecord(value);
  if (
    typeof v.state !== "string" ||
    !(VIDEO_STATES as readonly string[]).includes(v.state) ||
    typeof v.contentFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.contentFingerprint)
  )
    invalidVideoData();
  const byteSize = integer(v.byteSize, VIDEO_LIMITS.maxFileBytes),
    actualByteSize =
      v.actualByteSize === null
        ? null
        : integer(v.actualByteSize, VIDEO_LIMITS.maxFileBytes),
    meta = metadata(v.metadata);
  if (
    !byteSize ||
    (actualByteSize !== null && actualByteSize !== byteSize) ||
    (v.state === "ready" && (!meta || actualByteSize === null))
  )
    invalidVideoData();
  let failure: VideoAssetSnapshot["failure"] = null;
  if (v.failure !== null) {
    const f = videoRecord(v.failure);
    failure = {
      code: text(f.code, 80),
      message: text(f.message, 300),
      retryable: boolean(f.retryable),
    };
  }
  return {
    id: id(v.id),
    revision: integer(v.revision, 2_147_483_647),
    fileName: text(v.fileName, 255),
    contentFingerprint: v.contentFingerprint,
    state: v.state as VideoAssetSnapshot["state"],
    byteSize,
    actualByteSize,
    metadata: meta,
    failure,
    uploadExpiresAt: date(v.uploadExpiresAt),
    createdAt: date(v.createdAt),
    updatedAt: date(v.updatedAt),
    canDelete: boolean(v.canDelete),
  };
}
export function toVideoList(value: unknown): VideoListResponse {
  const v = videoRecord(value);
  if (!Array.isArray(v.videos) || v.videos.length > 50) invalidVideoData();
  const videos = v.videos.map(toVideoSnapshot);
  if (new Set(videos.map((x) => x.id)).size !== videos.length)
    invalidVideoData();
  const limits = videoRecord(v.limits),
    validator = videoRecord(v.validator);
  for (const [key, expected] of Object.entries(VIDEO_LIMITS))
    if (limits[key] !== expected) invalidVideoData();
  return {
    videos,
    nextCursor: v.nextCursor === null ? null : text(v.nextCursor, 1024),
    limits: { ...VIDEO_LIMITS },
    validator: {
      online: boolean(validator.online),
      lastSeenAt:
        validator.lastSeenAt === null ? null : date(validator.lastSeenAt),
    },
  };
}
export function toVideoMutation(value: unknown): VideoMutationResponse {
  const v = videoRecord(value);
  return { video: toVideoSnapshot(v.video), replayed: boolean(v.replayed) };
}
export function toUploadDescriptor(
  value: unknown,
  origin: string,
): VideoUploadDescriptor {
  const v = videoRecord(value);
  const assetId = id(v.assetId),
    objectPath = text(v.objectPath, 120);
  if (
    v.bucket !== "creator-vods" ||
    !new RegExp(`^[0-9a-f-]{36}/${assetId}/source\\.mp4$`).test(objectPath) ||
    v.mimeType !== "video/mp4"
  )
    invalidVideoData();
  const endpoint = `${origin}/storage/v1/upload/resumable`,
    uploadUrl = text(v.uploadUrl, 2048);
  let u: URL;
  try {
    u = new URL(uploadUrl);
  } catch {
    return invalidVideoData();
  }
  if (
    u.origin !== origin ||
    !u.pathname.startsWith("/storage/v1/upload/resumable/") ||
    u.pathname === "/storage/v1/upload/resumable/" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    invalidVideoData();
  return {
    assetId,
    bucket: "creator-vods",
    objectPath,
    endpoint,
    uploadUrl,
    expiresAt: date(v.expiresAt),
    byteSize: integer(v.byteSize, VIDEO_LIMITS.maxFileBytes),
    mimeType: "video/mp4",
  };
}
export function toVideoObject(value: unknown): {
  assetId: string;
  bucket: "creator-vods";
  objectPath: string;
} {
  const v = videoRecord(value);
  const assetId = id(v.assetId),
    objectPath = text(v.objectPath, 120);
  if (
    v.bucket !== "creator-vods" ||
    !new RegExp(`^[0-9a-f-]{36}/${assetId}/source\\.mp4$`).test(objectPath)
  )
    invalidVideoData();
  return { assetId, bucket: "creator-vods", objectPath };
}
