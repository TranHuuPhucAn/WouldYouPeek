import "server-only";
import type {
  ReportStatus,
  ReportTarget,
  SubmitReportRequest,
  ResolveReportRequest,
  VisibilityRequest,
} from "@/contracts/moderation";
import { REPORT_CATEGORIES } from "@/contracts/moderation";
import { isScenarioId, normalizeScenarioId } from "@/lib/scenario-id";
import { parseUuid } from "@/server/training/validation";
import { ApiError } from "@/server/http";
function invalid(): never {
  throw new ApiError("INVALID_REQUEST", "Use the supported report fields.");
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(v, k))
  )
    invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max: number, required = false) {
  if (typeof v !== "string" || [...v].length > max || v.includes("\u0000"))
    invalid();
  const t = v.trim();
  if (required && !t) invalid();
  return t;
}
function revision(v: unknown) {
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < 0 ||
    v > 2_147_483_647
  )
    invalid();
  return v;
}
export function parseModerationScenarioId(v: unknown) {
  if (!isScenarioId(v)) invalid();
  return normalizeScenarioId(v);
}
export function parseReportTarget(v: unknown): ReportTarget {
  if (!v || typeof v !== "object" || !("kind" in v)) invalid();
  if (v.kind === "publication") {
    const t = object(v, ["kind", "scenarioId", "contentVersion"]);
    const contentVersion = text(t.contentVersion, 80, true);
    if (!/^[\w.-]+$/.test(contentVersion)) invalid();
    return {
      kind: "publication",
      scenarioId: parseModerationScenarioId(t.scenarioId),
      contentVersion,
    };
  }
  if (v.kind === "session-item") {
    const t = object(v, ["kind", "sessionId", "itemId"]);
    return {
      kind: "session-item",
      sessionId: parseUuid(t.sessionId).toLowerCase(),
      itemId: parseUuid(t.itemId).toLowerCase(),
    };
  }
  return invalid();
}
export function parseReportCommand(v: unknown): SubmitReportRequest {
  const t = object(v, ["requestId", "target", "category", "detail"]);
  if (
    !REPORT_CATEGORIES.includes(t.category as SubmitReportRequest["category"])
  )
    invalid();
  return {
    requestId: parseUuid(t.requestId).toLowerCase(),
    target: parseReportTarget(t.target),
    category: t.category as SubmitReportRequest["category"],
    detail: text(t.detail, 2000, t.category === "other"),
  };
}
export type OperatorReportQuery = {
  status: ReportStatus;
  cursor: string | null;
  limit: number;
};
export function parseReportCursor(
  value: unknown,
  status: ReportStatus,
): string | null {
  if (value === undefined || value === null) return null;
  try {
    if (
      typeof value !== "string" ||
      value.length > 1024 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      invalid();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) invalid();
    const c = object(JSON.parse(bytes.toString("utf8")), [
      "status",
      "at",
      "id",
    ]);
    if (
      c.status !== status ||
      typeof c.at !== "string" ||
      c.at.length > 50 ||
      !Number.isFinite(Date.parse(c.at))
    )
      invalid();
    parseUuid(c.id);
    return value;
  } catch {
    return invalid();
  }
}
export function parseReportQuery(
  query: { status?: unknown; cursor?: unknown; limit?: unknown } = {},
): OperatorReportQuery {
  if (
    Object.keys(query).some((k) => !["status", "cursor", "limit"].includes(k))
  )
    invalid();
  const status = query.status ?? "open";
  if (status !== "open" && status !== "resolved") invalid();
  const limit =
    query.limit === undefined
      ? 20
      : typeof query.limit === "string" && /^\d+$/.test(query.limit)
        ? Number(query.limit)
        : query.limit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    invalid();
  return { status, cursor: parseReportCursor(query.cursor, status), limit };
}
export function parseResolutionCommand(v: unknown): ResolveReportRequest {
  const t = object(v, [
    "requestId",
    "expectedRevision",
    "resolution",
    "operatorNote",
  ]);
  if (t.resolution !== "dismissed" && t.resolution !== "addressed") invalid();
  return {
    requestId: parseUuid(t.requestId).toLowerCase(),
    expectedRevision: revision(t.expectedRevision),
    resolution: t.resolution,
    operatorNote: text(t.operatorNote, 2000, true),
  };
}
export function parseVisibilityCommand(v: unknown): VisibilityRequest {
  const t = object(v, ["requestId", "expectedRevision", "hidden", "reason"]);
  if (typeof t.hidden !== "boolean") invalid();
  return {
    requestId: parseUuid(t.requestId).toLowerCase(),
    expectedRevision: revision(t.expectedRevision),
    hidden: t.hidden,
    reason: text(t.reason, 1000, true),
  };
}
