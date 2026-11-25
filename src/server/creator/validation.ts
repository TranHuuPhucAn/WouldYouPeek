import "server-only";
import { ApiError } from "@/server/http";
import { parseUuid } from "@/server/training/validation";
import {
  normalizeDraftContent,
  validateDraftContent,
} from "@/lib/creator/content";
import {
  REVIEW_CHECKLIST_KEYS,
  type CreatorDraftContent,
  type CreatorFilter,
  type ReviewChecklist,
  type SaveDraftRequest,
} from "@/contracts/creator";

export function commandObject(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(value, k))
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "Send only the requested command fields.",
    );
  return value as Record<string, unknown>;
}
export function parseRevision(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 2_147_483_647
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "A valid saved revision is required.",
    );
  return value;
}
export function parseCreatorId(value: unknown): string {
  return parseUuid(value).toLowerCase();
}
export function parseCreatorFilter(value?: unknown): CreatorFilter {
  if (value === undefined || value === null) return "all";
  if (
    typeof value !== "string" ||
    !["all", "unpublished", "published", "withdrawn"].includes(value)
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "Choose a supported publication filter.",
    );
  return value as CreatorFilter;
}
export function parseCursor(
  value: unknown,
  kind: "creator" | "library",
  status?: CreatorFilter,
): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw new ApiError("INVALID_REQUEST", "The page cursor is invalid.");
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error();
    const cursor = commandObject(
      JSON.parse(decoded.toString("utf8")),
      kind === "creator"
        ? ["createdAt", "id", "status"]
        : ["publishedAt", "id"],
    );
    parseCreatorId(cursor.id);
    const date = kind === "creator" ? cursor.createdAt : cursor.publishedAt;
    if (
      typeof date !== "string" ||
      date.length > 50 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        date,
      ) ||
      !Number.isFinite(Date.parse(date))
    )
      throw new Error();
    if (kind === "creator" && cursor.status !== status) throw new Error();
    return value;
  } catch {
    throw new ApiError(
      "INVALID_REQUEST",
      "The page cursor is invalid for this view.",
    );
  }
}
export function parseCreatorCursor(
  value: unknown,
  status: CreatorFilter = "all",
) {
  return parseCursor(value, "creator", status);
}
export function parseCreateDraft(value: unknown) {
  const input = commandObject(value, ["requestId"]);
  return { requestId: parseUuid(input.requestId) };
}
export function parseSaveDraft(value: unknown): SaveDraftRequest {
  const input = commandObject(value, [
    "requestId",
    "expectedRevision",
    "content",
  ]);
  const issues = validateDraftContent(input.content);
  if (issues.length)
    throw new ApiError(
      "INVALID_REQUEST",
      "Correct the indicated draft fields.",
      { issues },
    );
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
    content: normalizeDraftContent(input.content as CreatorDraftContent),
  };
}
export function parseReviewCommand(value: unknown) {
  const input = commandObject(value, [
    "requestId",
    "expectedRevision",
    "checklist",
  ]);
  const checklist = commandObject(input.checklist, [...REVIEW_CHECKLIST_KEYS]);
  if (!REVIEW_CHECKLIST_KEYS.every((key) => checklist[key] === true))
    throw new ApiError(
      "INVALID_REQUEST",
      "Complete every review acknowledgement.",
    );
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
    checklist: checklist as ReviewChecklist,
  };
}
export function parsePublishCommand(value: unknown) {
  const input = commandObject(value, [
    "requestId",
    "expectedRevision",
    "reviewId",
  ]);
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
    reviewId: parseUuid(input.reviewId),
  };
}
export function parseUnpublishCommand(value: unknown) {
  const input = commandObject(value, ["requestId", "expectedRevision"]);
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
  };
}
export function parseReviewRevision(value: unknown): number {
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,9})$/.test(value))
    return parseRevision(Number(value));
  return parseRevision(value);
}
