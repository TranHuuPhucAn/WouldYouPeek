import type {
  PlaybackAccess,
  VideoAssetSnapshot,
  VideoListResponse,
  VideoMutationResponse,
  VideoUploadSessionResponse,
} from "@/contracts/video";
import { VIDEO_STATES } from "@/contracts/video";
import { invalidResponse, isRecord } from "./challenge-validation";
import { isDate, isUuid } from "./session-api";

const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => key in value);
const positive = (value: unknown, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;
const boundedText = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/** Accept only this deployment's Storage origin, never a provider-supplied redirect. */
export function storageUrl(value: unknown, pathPrefix: string): URL {
  if (typeof value !== "string" || value.length > 8192)
    return invalidResponse();
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.origin !== configured.origin ||
      url.username ||
      url.password ||
      url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      !decodeURIComponent(url.pathname).startsWith(pathPrefix)
    )
      return invalidResponse();
    return url;
  } catch {
    return invalidResponse();
  }
}

export function parseVideoAsset(
  value: unknown,
  expectedId?: string,
): VideoAssetSnapshot {
  if (
    !isRecord(value) ||
    !exact(value, [
      "id",
      "revision",
      "fileName",
      "contentFingerprint",
      "state",
      "byteSize",
      "actualByteSize",
      "metadata",
      "failure",
      "uploadExpiresAt",
      "createdAt",
      "updatedAt",
      "canDelete",
    ]) ||
    !isUuid(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !boundedText(value.fileName, 255) ||
    typeof value.contentFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.contentFingerprint) ||
    !VIDEO_STATES.includes(value.state as never) ||
    !positive(value.byteSize, 2 * 1024 ** 3) ||
    (value.actualByteSize !== null &&
      !positive(value.actualByteSize, 2 * 1024 ** 3)) ||
    !isDate(value.uploadExpiresAt) ||
    !isDate(value.createdAt) ||
    !isDate(value.updatedAt) ||
    typeof value.canDelete !== "boolean"
  )
    invalidResponse();
  if (value.metadata !== null) {
    const m = value.metadata;
    if (
      !isRecord(m) ||
      !exact(m, [
        "durationSeconds",
        "width",
        "height",
        "videoCodec",
        "pixelFormat",
        "audioCodec",
      ]) ||
      typeof m.durationSeconds !== "number" ||
      !Number.isFinite(m.durationSeconds) ||
      m.durationSeconds <= 0 ||
      m.durationSeconds > 7200 ||
      !positive(m.width, 1920) ||
      !positive(m.height, 1080) ||
      m.videoCodec !== "h264" ||
      m.pixelFormat !== "yuv420p" ||
      (m.audioCodec !== null && m.audioCodec !== "aac")
    )
      invalidResponse();
  }
  if (
    value.state === "ready" &&
    (value.metadata === null ||
      value.actualByteSize !== value.byteSize ||
      value.failure !== null)
  )
    invalidResponse();
  if (
    value.failure !== null &&
    (!isRecord(value.failure) ||
      !exact(value.failure, ["code", "message", "retryable"]) ||
      !boundedText(value.failure.code, 80) ||
      !boundedText(value.failure.message, 500) ||
      typeof value.failure.retryable !== "boolean")
  )
    invalidResponse();
  return value as VideoAssetSnapshot;
}

export function parseVideoList(value: unknown): VideoListResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["videos", "nextCursor", "limits", "validator"]) ||
    !Array.isArray(value.videos) ||
    value.videos.length > 50 ||
    !(value.nextCursor === null || boundedText(value.nextCursor, 1024)) ||
    !isRecord(value.limits) ||
    !exact(value.limits, [
      "maxFileBytes",
      "maxDurationSeconds",
      "maxWidth",
      "maxHeight",
      "maxPendingUploads",
      "maxOwnerBytes",
    ]) ||
    !Object.values(value.limits).every((v) => positive(v)) ||
    !isRecord(value.validator) ||
    !exact(value.validator, ["online", "lastSeenAt"]) ||
    typeof value.validator.online !== "boolean" ||
    !(value.validator.lastSeenAt === null || isDate(value.validator.lastSeenAt))
  )
    invalidResponse();
  const videos = value.videos.map((item) => parseVideoAsset(item));
  if (new Set(videos.map((item) => item.id)).size !== videos.length)
    invalidResponse();
  return { ...value, videos } as VideoListResponse;
}

export function parseVideoMutation(
  value: unknown,
  id?: string,
): VideoMutationResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["video", "replayed"]) ||
    typeof value.replayed !== "boolean"
  )
    invalidResponse();
  return { video: parseVideoAsset(value.video, id), replayed: value.replayed };
}

export function parseUploadSession(
  value: unknown,
  id: string,
): VideoUploadSessionResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["video", "upload"]) ||
    !isRecord(value.upload)
  )
    invalidResponse();
  const video = parseVideoAsset(value.video, id),
    u = value.upload;
  if (
    !exact(u, [
      "assetId",
      "bucket",
      "objectPath",
      "endpoint",
      "uploadUrl",
      "expiresAt",
      "byteSize",
      "mimeType",
    ]) ||
    u.assetId !== id ||
    u.bucket !== "creator-vods" ||
    typeof u.objectPath !== "string" ||
    !new RegExp(`^[a-f0-9-]{36}/${id}/source\\.mp4$`).test(u.objectPath) ||
    !isDate(u.expiresAt) ||
    u.byteSize !== video.byteSize ||
    u.mimeType !== "video/mp4"
  )
    invalidResponse();
  const endpoint = storageUrl(u.endpoint, "/storage/v1/upload/resumable");
  const uploadUrl = storageUrl(u.uploadUrl, "/storage/v1/upload/resumable/");
  if (
    endpoint.pathname.replace(/\/$/, "") !== "/storage/v1/upload/resumable" ||
    endpoint.search ||
    uploadUrl.search
  )
    invalidResponse();
  return { video, upload: u as VideoUploadSessionResponse["upload"] };
}

export function parsePlaybackAccess(
  value: unknown,
  assetId?: string,
): PlaybackAccess {
  if (
    !isRecord(value) ||
    !exact(value, ["assetId", "url", "expiresAt"]) ||
    !isUuid(value.assetId) ||
    (assetId !== undefined && value.assetId !== assetId) ||
    !isDate(value.expiresAt)
  )
    invalidResponse();
  const url = storageUrl(value.url, "/storage/v1/object/sign/creator-vods/");
  if (
    !decodeURIComponent(url.pathname).endsWith(
      `/${value.assetId}/source.mp4`,
    ) ||
    !url.searchParams.get("token")
  )
    invalidResponse();
  return value as PlaybackAccess;
}

export function validateVideoContinuity(
  next: VideoAssetSnapshot,
  previous: VideoAssetSnapshot,
) {
  if (
    next.id !== previous.id ||
    next.revision < previous.revision ||
    next.contentFingerprint !== previous.contentFingerprint ||
    next.byteSize !== previous.byteSize ||
    next.fileName !== previous.fileName
  )
    invalidResponse();
}
