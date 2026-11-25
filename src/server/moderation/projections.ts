import "server-only";
import type { Assessment, OptionFeedback } from "@/contracts/challenge";
import type {
  ReportReceipt,
  OperatorReport,
  OperatorReportList,
  OperatorReportMedia,
  OperatorReportDetail,
  ScenarioVisibility,
  CreatorVisibilityNotice,
  ResolveReportResponse,
  VisibilityResponse,
} from "@/contracts/moderation";
import { REPORT_CATEGORIES } from "@/contracts/moderation";
import { ApiError } from "@/server/http";
import { UUID_PATTERN } from "@/server/training/validation";
import { isScenarioId } from "@/lib/scenario-id";
import {
  toChallengeDetail,
  toChallengePreview,
} from "@/server/training/projections";
function invalid(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Reports could not be loaded safely. Please try again.",
  );
}
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) invalid();
  return v as Record<string, unknown>;
}
function text(v: unknown, max = 2000, required = true) {
  if (typeof v !== "string" || [...v].length > max || (required && !v.trim()))
    invalid();
  return v;
}
function id(v: unknown) {
  const s = text(v, 36);
  if (!UUID_PATTERN.test(s)) invalid();
  return s;
}
function scenario(v: unknown) {
  if (!isScenarioId(v)) invalid();
  return v as string;
}
function token(v: unknown) {
  const s = text(v, 80);
  if (!/^[\w.-]+$/.test(s)) invalid();
  return s;
}
function integer(v: unknown) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) invalid();
  return v;
}
function boolean(v: unknown) {
  if (typeof v !== "boolean") invalid();
  return v;
}
function date(v: unknown) {
  const s = text(v, 50);
  if (!Number.isFinite(Date.parse(s))) invalid();
  return s;
}
function status(v: unknown) {
  if (v !== "open" && v !== "resolved") invalid();
  return v;
}
function texts(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 100) invalid();
  return v.map((s) => text(s, 4000));
}
export function toReportReceipt(v: unknown): ReportReceipt {
  const r = record(v),
    report = record(r.report);
  return {
    report: {
      id: id(report.id),
      status: status(report.status),
      createdAt: date(report.createdAt),
    },
    replayed: boolean(r.replayed),
    duplicate: boolean(r.duplicate),
  };
}
export function toOperatorReport(v: unknown): OperatorReport {
  const r = record(v),
    s = status(r.status),
    revision = integer(r.revision),
    createdAt = date(r.createdAt);
  if (!REPORT_CATEGORIES.includes(r.category as OperatorReport["category"]))
    invalid();
  const detail = text(r.detail, 2000, r.category === "other");
  const resolvedAt = r.resolvedAt === null ? null : date(r.resolvedAt);
  if (
    s === "open" &&
    (revision !== 0 ||
      resolvedAt !== null ||
      r.resolution !== null ||
      r.operatorNote !== null)
  )
    invalid();
  if (
    s === "resolved" &&
    (revision !== 1 ||
      resolvedAt === null ||
      Date.parse(resolvedAt) < Date.parse(createdAt) ||
      (r.resolution !== "dismissed" && r.resolution !== "addressed"))
  )
    invalid();
  return {
    id: id(r.id),
    scenarioId: scenario(r.scenarioId),
    contentVersion: token(r.contentVersion),
    category: r.category as OperatorReport["category"],
    detail,
    status: s,
    revision,
    createdAt,
    resolvedAt,
    resolution:
      s === "open" ? null : (r.resolution as OperatorReport["resolution"]),
    operatorNote: s === "open" ? null : text(r.operatorNote, 2000),
  };
}
export function toOperatorReportList(v: unknown): OperatorReportList {
  const r = record(v);
  if (!Array.isArray(r.reports) || r.reports.length > 50) invalid();
  const reports = r.reports.map(toOperatorReport);
  if (new Set(reports.map((r) => r.id)).size !== reports.length) invalid();
  return {
    reports,
    nextCursor: r.nextCursor === null ? null : text(r.nextCursor, 1024),
  };
}
export function toVisibilityState(v: unknown): ScenarioVisibility {
  const r = record(v),
    revision = integer(r.revision),
    hidden = boolean(r.hidden),
    reason = r.reason === null ? null : text(r.reason, 1000),
    changedAt = r.changedAt === null ? null : date(r.changedAt);
  const affectedPlaylistCount = integer(r.affectedPlaylistCount),
    affectedEditorialPlaylistCount = integer(r.affectedEditorialPlaylistCount);
  if (
    (revision === 0 && (hidden || reason !== null || changedAt !== null)) ||
    (revision > 0 && (reason === null || changedAt === null)) ||
    affectedEditorialPlaylistCount > affectedPlaylistCount
  )
    invalid();
  return {
    scenarioId: scenario(r.scenarioId),
    hidden,
    revision,
    reason,
    changedAt,
    affectedPlaylistCount,
    affectedEditorialPlaylistCount,
    creatorPublished: boolean(r.creatorPublished),
    currentContentVersion:
      r.currentContentVersion === null ? null : token(r.currentContentVersion),
  };
}
export function toCreatorVisibilityNotice(v: unknown): CreatorVisibilityNotice {
  const r = record(v),
    hidden = boolean(r.hidden);
  if (!hidden) {
    if (r.reason !== null || r.changedAt !== null) invalid();
    return { hidden: false, reason: null, changedAt: null };
  }
  return {
    hidden: true,
    reason: text(r.reason, 1000),
    changedAt: date(r.changedAt),
  };
}
export function toOperatorReportMedia(v: unknown): OperatorReportMedia {
  const r = record(v),
    challenge = toChallengeDetail(r.challenge);
  // Validate an actual media segment independently of any learner choice/result.
  const reveal = toChallengePreview({ ...challenge, setup: r.reveal }).setup;
  if (
    !Array.isArray(r.optionFeedback) ||
    r.optionFeedback.length !== challenge.options.length
  )
    invalid();
  const ids = challenge.options.map((o) => o.id);
  const optionFeedback: OptionFeedback[] = r.optionFeedback.map((value) => {
    const f = record(value),
      optionId = text(f.optionId, 100);
    if (
      !ids.includes(optionId) ||
      !["recommended", "reasonable", "risky"].includes(String(f.assessment))
    )
      invalid();
    return {
      optionId,
      assessment: f.assessment as Assessment,
      explanation: text(f.explanation, 4000),
      acceptableWhen: texts(f.acceptableWhen),
      risks: texts(f.risks),
    };
  });
  if (new Set(optionFeedback.map((f) => f.optionId)).size !== ids.length)
    invalid();
  let observedAction: OperatorReportMedia["observedAction"];
  let analysis: OperatorReportMedia["analysis"];
  if (r.observedAction !== undefined) {
    const o = record(r.observedAction);
    const optionId = text(o.optionId, 100);
    if (!ids.includes(optionId)) invalid();
    observedAction = { optionId, description: text(o.description, 4000) };
  }
  if (r.analysis !== undefined) {
    const a = record(r.analysis);
    if (!["ai", "creator", "ai-assisted"].includes(String(a.author))) invalid();
    analysis = {
      author: a.author as NonNullable<
        OperatorReportMedia["analysis"]
      >["author"],
      notice: text(a.notice, 4000),
      rationale: text(a.rationale, 8000),
      limitations: texts(a.limitations),
    };
  }
  if (challenge.setup.kind === "youtube") {
    if (
      reveal.kind !== "youtube" ||
      reveal.videoId !== challenge.setup.videoId ||
      reveal.startSeconds !== challenge.setup.endSeconds ||
      !observedAction ||
      !analysis
    )
      invalid();
  } else if (challenge.setup.kind === "uploaded-video") {
    if (
      reveal.kind !== "uploaded-video" ||
      reveal.assetId !== challenge.setup.assetId ||
      reveal.startSeconds !== challenge.setup.endSeconds ||
      !observedAction ||
      !analysis
    )
      invalid();
  } else if (challenge.mediaStatus === "demo" && observedAction) invalid();
  return {
    challenge,
    reveal,
    optionFeedback,
    takeaway: text(r.takeaway, 4000),
    outcomeText: text(r.outcomeText, 4000),
    ...(observedAction ? { observedAction } : {}),
    ...(analysis ? { analysis } : {}),
  };
}
export function toOperatorReportDetail(v: unknown): OperatorReportDetail {
  const r = record(v),
    report = toOperatorReport(r.report),
    media = toOperatorReportMedia(r.media),
    visibility = toVisibilityState(r.visibility);
  if (
    media.challenge.id !== report.scenarioId ||
    media.challenge.contentVersion !== report.contentVersion ||
    visibility.scenarioId !== report.scenarioId
  )
    invalid();
  return { report, media, visibility };
}
export function toResolveReportResponse(v: unknown): ResolveReportResponse {
  const r = record(v);
  return { report: toOperatorReport(r.report), replayed: boolean(r.replayed) };
}
export function toVisibilityResponse(v: unknown): VisibilityResponse {
  const r = record(v);
  return {
    visibility: toVisibilityState(r.visibility),
    replayed: boolean(r.replayed),
  };
}
