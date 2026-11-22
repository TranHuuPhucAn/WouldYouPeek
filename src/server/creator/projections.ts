import "server-only";
import type {
  CreatorPublication,
  CreatorScenarioSnapshot,
  CreatorScenarioSummary,
  CreatorListResponse,
  CreatorMutationResponse,
  CreatorReviewPreview,
  ReviewChecklist,
  ValidationIssue,
  CreatorDraftContent,
} from "@/contracts/creator";
import { REVIEW_CHECKLIST_KEYS } from "@/contracts/creator";
import { validateDraftContent } from "@/lib/creator/content";
import { ApiError } from "@/server/http";
import {
  toChallengeDetail,
  toSavedAnswer,
} from "@/server/training/projections";
import { UUID_PATTERN } from "@/server/training/validation";
import { toCreatorVisibilityNotice } from "@/server/moderation/projections";

function invalid(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Creator content could not be loaded safely.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string {
  if (typeof value !== "string" || value.length > max) invalid();
  return value;
}
function id(value: unknown): string {
  const v = text(value, 36);
  if (!UUID_PATTERN.test(v)) invalid();
  return v;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid();
  return value;
}
function date(value: unknown): string {
  const v = text(value, 50);
  if (!Number.isFinite(Date.parse(v))) invalid();
  return v;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
function version(value: unknown): string | null {
  if (value === null) return null;
  const v = text(value, 80);
  if (!/^creator-[1-9]\d*$/.test(v)) invalid();
  return v;
}
function publication(value: unknown): CreatorPublication {
  const p = record(value);
  if (
    typeof p.state !== "string" ||
    !["never_published", "published", "withdrawn"].includes(p.state)
  )
    invalid();
  const currentVersion = version(p.currentVersion),
    publishedAt = p.publishedAt === null ? null : date(p.publishedAt);
  if (
    (p.state === "never_published") !== (currentVersion === null) ||
    (currentVersion === null) !== (publishedAt === null)
  )
    invalid();
  return {
    state: p.state as CreatorPublication["state"],
    currentVersion,
    publishedAt,
    hasUnpublishedChanges: boolean(p.hasUnpublishedChanges),
    operatorVisibility: toCreatorVisibilityNotice(p.operatorVisibility),
  };
}
function issues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value) || value.length > 100) invalid();
  return value.map((item) => {
    const i = record(item);
    return {
      path: text(i.path, 160),
      code: text(i.code, 60),
      message: text(i.message, 300),
    };
  });
}
export function toCreatorSnapshot(value: unknown): CreatorScenarioSnapshot {
  const s = record(value),
    draft = record(s.draft),
    ready = record(s.readiness);
  const revision = integer(s.revision),
    draftRevision = integer(draft.revision);
  if (revision < draftRevision || validateDraftContent(draft.content).length)
    invalid();
  const blockers = issues(ready.issues),
    canReview = boolean(ready.canReview);
  if (canReview !== (blockers.length === 0)) invalid();
  let review: CreatorScenarioSnapshot["review"] = null;
  if (s.review !== null) {
    const r = record(s.review),
      checklist = record(r.checklist);
    if (
      integer(r.draftRevision) !== draftRevision ||
      !canReview ||
      Object.keys(checklist).length !== REVIEW_CHECKLIST_KEYS.length ||
      !REVIEW_CHECKLIST_KEYS.every((k) => checklist[k] === true)
    )
      invalid();
    review = {
      id: id(r.id),
      draftRevision,
      reviewedAt: date(r.reviewedAt),
      checklist: Object.fromEntries(
        REVIEW_CHECKLIST_KEYS.map((k) => [k, true]),
      ) as ReviewChecklist,
    };
  }
  return {
    id: id(s.id),
    revision,
    draft: {
      revision: draftRevision,
      content: structuredClone(draft.content) as CreatorDraftContent,
      savedAt: date(draft.savedAt),
    },
    readiness: { issues: blockers, canReview },
    review,
    publication: publication(s.publication),
    updatedAt: date(s.updatedAt),
  };
}
export function toCreatorSummary(value: unknown): CreatorScenarioSummary {
  const s = record(value),
    revision = integer(s.revision),
    draftRevision = integer(s.draftRevision);
  if (revision < draftRevision) invalid();
  const canReview = boolean(s.canReview),
    reviewed = boolean(s.reviewed);
  if (reviewed && !canReview) invalid();
  return {
    id: id(s.id),
    title: text(s.title, 240),
    revision,
    draftRevision,
    canReview,
    reviewed,
    publication: publication(s.publication),
    createdAt: date(s.createdAt),
    updatedAt: date(s.updatedAt),
  };
}
export function toCreatorList(value: unknown): CreatorListResponse {
  const list = record(value);
  if (!Array.isArray(list.scenarios) || list.scenarios.length > 50) invalid();
  const scenarios = list.scenarios.map(toCreatorSummary);
  if (new Set(scenarios.map((s) => s.id)).size !== scenarios.length) invalid();
  return {
    scenarios,
    nextCursor: list.nextCursor === null ? null : text(list.nextCursor, 1024),
  };
}
export function toCreatorMutation(value: unknown): CreatorMutationResponse {
  const m = record(value);
  return {
    scenario: toCreatorSnapshot(m.scenario),
    replayed: boolean(m.replayed),
    publishedVersion: version(m.publishedVersion),
  };
}
export function toCreatorReviewPreview(value: unknown): CreatorReviewPreview {
  const p = record(value),
    scenario = toCreatorSnapshot(p.scenario),
    challenge = toChallengeDetail(p.challenge),
    feedback = record(p.feedbackByOption);
  if (
    !scenario.readiness.canReview ||
    challenge.id !== scenario.id ||
    Object.keys(feedback).length !== challenge.options.length
  )
    invalid();
  const feedbackByOption = Object.fromEntries(
    challenge.options.map((option) => {
      const result = toSavedAnswer(
        {
          id: scenario.id,
          answeredAt: scenario.updatedAt,
          result: feedback[option.id],
        },
        challenge,
      ).result;
      if (result.selectedOptionId !== option.id) invalid();
      return [option.id, result];
    }),
  );
  return { scenario, challenge, feedbackByOption };
}
