import "server-only";
import type {
  CreateVideoRequest,
  PlaybackContext,
  VideoCommand,
} from "@/contracts/video";
import { validateUploadSelection } from "@/lib/video/upload-policy";
import { ApiError } from "@/server/http";
import { UUID_PATTERN } from "@/server/training/validation";

function invalid(): never {
  throw new ApiError(
    "INVALID_REQUEST",
    "Use the supported video request fields.",
  );
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(value, k))
  )
    invalid();
  return value as Record<string, unknown>;
}
export function parseVideoId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}
function revision(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 2_147_483_647
  )
    invalid();
  return value;
}
export function parseCreateVideo(value: unknown): CreateVideoRequest {
  const v = object(value, [
    "requestId",
    "fileName",
    "byteSize",
    "mimeType",
    "contentFingerprint",
  ]);
  if (
    typeof v.fileName !== "string" ||
    typeof v.byteSize !== "number" ||
    v.mimeType !== "video/mp4" ||
    typeof v.contentFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.contentFingerprint) ||
    validateUploadSelection({
      name: v.fileName,
      size: v.byteSize,
      type: v.mimeType,
    }).length
  )
    invalid();
  return {
    requestId: parseVideoId(v.requestId),
    fileName: v.fileName,
    byteSize: v.byteSize,
    mimeType: v.mimeType,
    contentFingerprint: v.contentFingerprint,
  };
}
export function parseVideoCommand(value: unknown): VideoCommand {
  const v = object(value, ["requestId", "expectedRevision"]);
  return {
    requestId: parseVideoId(v.requestId),
    expectedRevision: revision(v.expectedRevision),
  };
}
export function parseEmptyVideoCommand(value: unknown): void {
  object(value, []);
}
export function parseVideoCursor(value?: string | null): string | null {
  if (!value) return null;
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) invalid();
    const v = object(JSON.parse(decoded.toString("utf8")), ["createdAt", "id"]);
    parseVideoId(v.id);
    if (
      typeof v.createdAt !== "string" ||
      !Number.isFinite(Date.parse(v.createdAt))
    )
      invalid();
    return value;
  } catch {
    return invalid();
  }
}
export function parsePlaybackContext(value: unknown): PlaybackContext {
  if (!value || typeof value !== "object" || !("kind" in value)) invalid();
  if (value.kind === "creator-asset") {
    const v = object(value, ["kind", "assetId"]);
    return { kind: "creator-asset", assetId: parseVideoId(v.assetId) };
  }
  if (value.kind === "library-scenario") {
    const v = object(value, ["kind", "scenarioId"]);
    return { kind: "library-scenario", scenarioId: parseVideoId(v.scenarioId) };
  }
  if (value.kind === "creator-scenario") {
    const v = object(value, ["kind", "scenarioId", "revision", "phase"]);
    if (v.phase !== "setup" && v.phase !== "reveal") invalid();
    return {
      kind: "creator-scenario",
      scenarioId: parseVideoId(v.scenarioId),
      revision: revision(v.revision),
      phase: v.phase,
    };
  }
  if (value.kind === "session-item") {
    const v = object(value, ["kind", "sessionId", "itemId", "phase"]);
    if (v.phase !== "setup" && v.phase !== "reveal") invalid();
    return {
      kind: "session-item",
      sessionId: parseVideoId(v.sessionId),
      itemId: parseVideoId(v.itemId),
      phase: v.phase,
    };
  }
  return invalid();
}
