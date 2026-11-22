import {
  REPORT_CATEGORIES,
  type ReportTarget,
  type SubmitReportRequest,
  type ReportReceipt,
  type OperatorReport,
  type OperatorReportList,
  type OperatorReportMedia,
  type OperatorReportDetail,
  type ScenarioVisibility,
  type ResolveReportRequest,
  type ResolveReportResponse,
  type VisibilityRequest,
  type VisibilityResponse,
  type ReportStatus,
} from "@/contracts/moderation";
import { isScenarioId } from "@/lib/scenario-id";
import { ApiClientError, readApiResponse } from "./api-response";
import {
  invalidResponse,
  isRecord,
  isText,
  isTextList,
  isMedia,
  isAnalysis,
  isAssessment,
  parseChallengeDetail,
} from "./challenge-validation";
import { isUuid, isDate } from "./session-api";
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const count = (v: unknown) =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 2147483647;
const text = (v: unknown, max: number, empty = false): v is string =>
  typeof v === "string" && (empty || !!v.trim()) && [...v].length <= max;
const version = (v: unknown): v is string => text(v, 80) && /^[\w.-]+$/.test(v);
const status = (v: unknown) => v === "open" || v === "resolved";
const category = (v: unknown) =>
  REPORT_CATEGORIES.includes(v as (typeof REPORT_CATEGORIES)[number]);
function badRequest(): never {
  throw new ApiClientError(
    "INVALID_REQUEST",
    "Check the report details and try again.",
    400,
  );
}
export function validateReportTarget(value: unknown): ReportTarget {
  if (!isRecord(value)) badRequest();
  if (
    value.kind === "publication" &&
    exact(value, ["kind", "scenarioId", "contentVersion"]) &&
    isScenarioId(value.scenarioId) &&
    version(value.contentVersion)
  )
    return value as ReportTarget;
  if (
    value.kind === "session-item" &&
    exact(value, ["kind", "sessionId", "itemId"]) &&
    isUuid(value.sessionId) &&
    isUuid(value.itemId)
  )
    return value as ReportTarget;
  return badRequest();
}
export function parseReportReceipt(v: unknown): ReportReceipt {
  if (
    !isRecord(v) ||
    !exact(v, ["report", "replayed", "duplicate"]) ||
    typeof v.replayed !== "boolean" ||
    typeof v.duplicate !== "boolean" ||
    !isRecord(v.report) ||
    !exact(v.report, ["id", "status", "createdAt"]) ||
    !isUuid(v.report.id) ||
    !status(v.report.status) ||
    !isDate(v.report.createdAt)
  )
    invalidResponse();
  return v as ReportReceipt;
}
export function parseOperatorReport(
  v: unknown,
  expectedId?: string,
): OperatorReport {
  if (
    !isRecord(v) ||
    !exact(v, [
      "id",
      "scenarioId",
      "contentVersion",
      "category",
      "detail",
      "status",
      "revision",
      "createdAt",
      "resolvedAt",
      "resolution",
      "operatorNote",
    ]) ||
    !isUuid(v.id) ||
    (expectedId && v.id !== expectedId) ||
    !isScenarioId(v.scenarioId) ||
    !version(v.contentVersion) ||
    !category(v.category) ||
    !text(v.detail, 2000, v.category !== "other") ||
    !status(v.status) ||
    !count(v.revision) ||
    !isDate(v.createdAt)
  )
    invalidResponse();
  if (
    v.status === "open"
      ? v.revision !== 0 ||
        v.resolvedAt !== null ||
        v.resolution !== null ||
        v.operatorNote !== null
      : v.revision !== 1 ||
        !isDate(v.resolvedAt) ||
        Date.parse(v.resolvedAt) < Date.parse(v.createdAt) ||
        !["dismissed", "addressed"].includes(String(v.resolution)) ||
        !text(v.operatorNote, 2000)
  )
    invalidResponse();
  return v as OperatorReport;
}
export function parseVisibility(
  v: unknown,
  expectedId?: string,
): ScenarioVisibility {
  if (
    !isRecord(v) ||
    !exact(v, [
      "scenarioId",
      "hidden",
      "revision",
      "reason",
      "changedAt",
      "affectedPlaylistCount",
      "affectedEditorialPlaylistCount",
      "creatorPublished",
      "currentContentVersion",
    ]) ||
    !isScenarioId(v.scenarioId) ||
    (expectedId && v.scenarioId !== expectedId) ||
    typeof v.hidden !== "boolean" ||
    !count(v.revision) ||
    !count(v.affectedPlaylistCount) ||
    !count(v.affectedEditorialPlaylistCount) ||
    Number(v.affectedEditorialPlaylistCount) >
      Number(v.affectedPlaylistCount) ||
    typeof v.creatorPublished !== "boolean" ||
    (v.currentContentVersion !== null && !version(v.currentContentVersion))
  )
    invalidResponse();
  if (
    v.revision === 0
      ? v.hidden !== false || v.reason !== null || v.changedAt !== null
      : !text(v.reason, 1000) || !isDate(v.changedAt)
  )
    invalidResponse();
  if (v.creatorPublished && v.currentContentVersion === null) invalidResponse();
  return v as ScenarioVisibility;
}
export function parseOperatorMedia(v: unknown): OperatorReportMedia {
  if (
    !isRecord(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          "challenge",
          "reveal",
          "observedAction",
          "analysis",
          "optionFeedback",
          "takeaway",
          "outcomeText",
        ].includes(k),
    ) ||
    !isMedia(v.reveal) ||
    !isText(v.takeaway) ||
    !isText(v.outcomeText) ||
    !Array.isArray(v.optionFeedback)
  )
    invalidResponse();
  const challenge = parseChallengeDetail(v.challenge);
  const options = new Set(challenge.options.map((o) => o.id));
  if (v.optionFeedback.length !== options.size) invalidResponse();
  const seen = new Set<string>();
  for (const option of v.optionFeedback) {
    if (
      !isRecord(option) ||
      !exact(option, [
        "optionId",
        "assessment",
        "explanation",
        "acceptableWhen",
        "risks",
      ]) ||
      !isText(option.optionId) ||
      !options.has(option.optionId) ||
      seen.has(option.optionId) ||
      !isAssessment(option.assessment) ||
      !isText(option.explanation) ||
      !isTextList(option.acceptableWhen) ||
      !isTextList(option.risks)
    )
      invalidResponse();
    seen.add(option.optionId);
  }
  if (
    v.observedAction !== undefined &&
    (!isRecord(v.observedAction) ||
      !exact(v.observedAction, ["optionId", "description"]) ||
      !isText(v.observedAction.optionId) ||
      !options.has(v.observedAction.optionId) ||
      !isText(v.observedAction.description))
  )
    invalidResponse();
  if (v.analysis !== undefined && !isAnalysis(v.analysis)) invalidResponse();
  if (
    challenge.setup.kind === "youtube" ||
    challenge.setup.kind === "uploaded-video"
  ) {
    const reveal = v.reveal;
    if (
      !v.observedAction ||
      !v.analysis ||
      reveal.kind !== challenge.setup.kind ||
      !("startSeconds" in reveal) ||
      reveal.startSeconds !== challenge.setup.endSeconds
    )
      invalidResponse();
    if (
      challenge.setup.kind === "youtube" &&
      (reveal.kind !== "youtube" || reveal.videoId !== challenge.setup.videoId)
    )
      invalidResponse();
    if (
      challenge.setup.kind === "uploaded-video" &&
      (reveal.kind !== "uploaded-video" ||
        reveal.assetId !== challenge.setup.assetId)
    )
      invalidResponse();
  }
  if (challenge.mediaStatus === "demo" && v.observedAction !== undefined)
    invalidResponse();
  return { ...v, challenge } as OperatorReportMedia;
}
export function parseOperatorDetail(
  v: unknown,
  expectedId?: string,
): OperatorReportDetail {
  if (!isRecord(v) || !exact(v, ["report", "media", "visibility"]))
    invalidResponse();
  const report = parseOperatorReport(v.report, expectedId),
    media = parseOperatorMedia(v.media),
    visibility = parseVisibility(v.visibility, report.scenarioId);
  if (
    media.challenge.id !== report.scenarioId ||
    media.challenge.contentVersion !== report.contentVersion
  )
    invalidResponse();
  return { report, media, visibility };
}
export function parseOperatorList(v: unknown): OperatorReportList {
  if (
    !isRecord(v) ||
    !exact(v, ["reports", "nextCursor"]) ||
    !Array.isArray(v.reports) ||
    v.reports.length > 50 ||
    !(v.nextCursor === null || text(v.nextCursor, 1024))
  )
    invalidResponse();
  const reports = v.reports.map((r) => parseOperatorReport(r));
  if (new Set(reports.map((r) => r.id)).size !== reports.length)
    invalidResponse();
  return { reports, nextCursor: v.nextCursor };
}
async function request(url: string, signal?: AbortSignal, body?: unknown) {
  return readApiResponse(
    await fetch(url, {
      cache: "no-store",
      signal,
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}
export async function submitScenarioReport(
  input: SubmitReportRequest,
  signal?: AbortSignal,
) {
  validateReportTarget(input.target);
  if (
    !isUuid(input.requestId) ||
    !category(input.category) ||
    !text(input.detail, 2000, input.category !== "other")
  )
    badRequest();
  return parseReportReceipt(
    await request("/api/scenario-reports", signal, input),
  );
}
export async function fetchOperatorReports(
  query: { status?: ReportStatus; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query.status) {
    if (!status(query.status)) badRequest();
    params.set("status", query.status);
  }
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50)
      badRequest();
    params.set("limit", String(query.limit));
  }
  return parseOperatorList(
    await request(
      `/api/operator/reports${params.size ? `?${params}` : ""}`,
      signal,
    ),
  );
}
export async function fetchOperatorReport(id: string, signal?: AbortSignal) {
  if (!isUuid(id)) badRequest();
  return parseOperatorDetail(
    await request(`/api/operator/reports/${encodeURIComponent(id)}`, signal),
    id,
  );
}
export async function resolveReport(
  id: string,
  input: ResolveReportRequest,
  signal?: AbortSignal,
): Promise<ResolveReportResponse> {
  if (
    !isUuid(id) ||
    !isUuid(input.requestId) ||
    !count(input.expectedRevision) ||
    !["dismissed", "addressed"].includes(input.resolution) ||
    !text(input.operatorNote, 2000)
  )
    badRequest();
  const v = await request(
    `/api/operator/reports/${encodeURIComponent(id)}/resolve`,
    signal,
    input,
  );
  if (
    !isRecord(v) ||
    !exact(v, ["report", "replayed"]) ||
    typeof v.replayed !== "boolean"
  )
    invalidResponse();
  const report = parseOperatorReport(v.report, id);
  if (report.status !== "resolved") invalidResponse();
  return { report, replayed: v.replayed };
}
export async function setScenarioVisibility(
  id: string,
  input: VisibilityRequest,
  signal?: AbortSignal,
): Promise<VisibilityResponse> {
  if (
    !isScenarioId(id) ||
    !isUuid(input.requestId) ||
    !count(input.expectedRevision) ||
    typeof input.hidden !== "boolean" ||
    !text(input.reason, 1000)
  )
    badRequest();
  const v = await request(
    `/api/operator/scenarios/${encodeURIComponent(id)}/visibility`,
    signal,
    input,
  );
  if (
    !isRecord(v) ||
    !exact(v, ["visibility", "replayed"]) ||
    typeof v.replayed !== "boolean"
  )
    invalidResponse();
  return {
    visibility: parseVisibility(v.visibility, id),
    replayed: v.replayed,
  };
}
