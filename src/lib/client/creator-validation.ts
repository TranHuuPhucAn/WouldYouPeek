import type {
  CreatorListResponse,
  CreatorMutationResponse,
  CreatorPublication,
  CreatorReviewPreview,
  CreatorScenarioSnapshot,
  CreatorScenarioSummary,
  ValidationIssue,
} from "@/contracts/creator";
import { REVIEW_CHECKLIST_KEYS } from "@/contracts/creator";
import { validateDraftContent } from "@/lib/creator/content";
import {
  invalidResponse,
  isRecord,
  parseAnswerResponse,
  parseChallengeDetail,
  validateAnswerForChallenge,
} from "./challenge-validation";
import { isDate, isUuid } from "./session-api";
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((key) => key in v);
const version = (v: unknown) =>
  v === null || (typeof v === "string" && v.length > 0 && v.length <= 100);
export function parseValidationIssues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value) || value.length > 100) invalidResponse();
  return value.map((issue) => {
    if (
      !isRecord(issue) ||
      !exact(issue, ["path", "code", "message"]) ||
      typeof issue.path !== "string" ||
      !/^[\w.\[\]-]{0,160}$/.test(issue.path) ||
      typeof issue.code !== "string" ||
      !issue.code ||
      issue.code.length > 80 ||
      typeof issue.message !== "string" ||
      !issue.message ||
      issue.message.length > 500
    )
      invalidResponse();
    return { path: issue.path, code: issue.code, message: issue.message };
  });
}
function parsePublication(value: unknown): CreatorPublication {
  if (
    !isRecord(value) ||
    !exact(value, [
      "state",
      "currentVersion",
      "publishedAt",
      "hasUnpublishedChanges",
      "operatorVisibility",
    ]) ||
    !["never_published", "published", "withdrawn"].includes(
      String(value.state),
    ) ||
    !version(value.currentVersion) ||
    typeof value.hasUnpublishedChanges !== "boolean"
  )
    invalidResponse();
  if (
    value.state === "never_published"
      ? value.currentVersion !== null || value.publishedAt !== null
      : value.currentVersion === null || !isDate(value.publishedAt)
  )
    invalidResponse();
  const hold = value.operatorVisibility;
  if (
    !isRecord(hold) ||
    !exact(hold, ["hidden", "reason", "changedAt"]) ||
    typeof hold.hidden !== "boolean" ||
    (hold.hidden
      ? typeof hold.reason !== "string" ||
        !hold.reason.trim() ||
        [...hold.reason].length > 1000 ||
        !isDate(hold.changedAt)
      : hold.reason !== null || hold.changedAt !== null)
  )
    invalidResponse();
  return value as CreatorPublication;
}
export function parseCreatorSnapshot(
  value: unknown,
  expectedId?: string,
): CreatorScenarioSnapshot {
  if (
    !isRecord(value) ||
    !exact(value, [
      "id",
      "revision",
      "draft",
      "readiness",
      "review",
      "publication",
      "updatedAt",
    ]) ||
    !isUuid(value.id) ||
    (expectedId && expectedId !== value.id) ||
    !count(value.revision) ||
    !isDate(value.updatedAt)
  )
    invalidResponse();
  if (
    !isRecord(value.draft) ||
    !exact(value.draft, ["revision", "content", "savedAt"]) ||
    !count(value.draft.revision) ||
    Number(value.draft.revision) > Number(value.revision) ||
    !isDate(value.draft.savedAt) ||
    validateDraftContent(value.draft.content).length
  )
    invalidResponse();
  if (
    !isRecord(value.readiness) ||
    !exact(value.readiness, ["issues", "canReview"]) ||
    typeof value.readiness.canReview !== "boolean"
  )
    invalidResponse();
  const issues = parseValidationIssues(value.readiness.issues);
  if (value.readiness.canReview !== (issues.length === 0)) invalidResponse();
  parsePublication(value.publication);
  if (value.review !== null) {
    const review = value.review;
    if (
      !isRecord(review) ||
      !exact(review, ["id", "draftRevision", "reviewedAt", "checklist"]) ||
      !isUuid(review.id) ||
      review.draftRevision !== value.draft.revision ||
      !isDate(review.reviewedAt) ||
      !isRecord(review.checklist) ||
      !exact(review.checklist, [...REVIEW_CHECKLIST_KEYS]) ||
      !REVIEW_CHECKLIST_KEYS.every(
        (key) => (review.checklist as Record<string, unknown>)[key] === true,
      ) ||
      !value.readiness.canReview
    )
      invalidResponse();
  }
  if (Date.parse(value.updatedAt) < Date.parse(value.draft.savedAt))
    invalidResponse();
  return value as CreatorScenarioSnapshot;
}
export function parseCreatorList(value: unknown): CreatorListResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["scenarios", "nextCursor"]) ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length > 50 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        value.nextCursor.length > 0 &&
        value.nextCursor.length <= 1024)
    )
  )
    invalidResponse();
  const scenarios = value.scenarios.map((item): CreatorScenarioSummary => {
    if (
      !isRecord(item) ||
      !exact(item, [
        "id",
        "title",
        "revision",
        "draftRevision",
        "canReview",
        "reviewed",
        "publication",
        "createdAt",
        "updatedAt",
      ]) ||
      !isUuid(item.id) ||
      typeof item.title !== "string" ||
      [...item.title].length > 120 ||
      !count(item.revision) ||
      !count(item.draftRevision) ||
      Number(item.draftRevision) > Number(item.revision) ||
      typeof item.canReview !== "boolean" ||
      typeof item.reviewed !== "boolean" ||
      (item.reviewed && !item.canReview) ||
      !isDate(item.createdAt) ||
      !isDate(item.updatedAt)
    )
      invalidResponse();
    parsePublication(item.publication);
    return item as CreatorScenarioSummary;
  });
  if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length)
    invalidResponse();
  return { scenarios, nextCursor: value.nextCursor };
}
export function parseCreatorMutationResponse(
  value: unknown,
  expectedId?: string,
): CreatorMutationResponse {
  if (
    !isRecord(value) ||
    !exact(value, ["scenario", "replayed", "publishedVersion"]) ||
    typeof value.replayed !== "boolean" ||
    !version(value.publishedVersion)
  )
    invalidResponse();
  return {
    scenario: parseCreatorSnapshot(value.scenario, expectedId),
    replayed: value.replayed,
    publishedVersion: value.publishedVersion as string | null,
  };
}
export function validateCreatorContinuity(
  next: CreatorScenarioSnapshot,
  previous: CreatorScenarioSnapshot,
) {
  if (
    next.id !== previous.id ||
    next.revision < previous.revision ||
    next.draft.revision < previous.draft.revision
  )
    invalidResponse();
}
export function parseCreatorReview(
  value: unknown,
  expectedId?: string,
  expectedRevision?: number,
): CreatorReviewPreview {
  if (
    !isRecord(value) ||
    !exact(value, ["scenario", "challenge", "feedbackByOption"]) ||
    !isRecord(value.feedbackByOption)
  )
    invalidResponse();
  const scenario = parseCreatorSnapshot(value.scenario, expectedId);
  if (
    !scenario.readiness.canReview ||
    (expectedRevision !== undefined && scenario.revision !== expectedRevision)
  )
    invalidResponse();
  const challenge = parseChallengeDetail(value.challenge);
  if (
    challenge.id !== scenario.id ||
    Object.keys(value.feedbackByOption).length !== challenge.options.length
  )
    invalidResponse();
  const feedbackByOption = Object.fromEntries(
    challenge.options.map((option) => {
      const answer = parseAnswerResponse(
        (value.feedbackByOption as Record<string, unknown>)[option.id],
      );
      validateAnswerForChallenge(answer, challenge);
      if (answer.selectedOptionId !== option.id) invalidResponse();
      return [option.id, answer];
    }),
  );
  return { scenario, challenge, feedbackByOption };
}
