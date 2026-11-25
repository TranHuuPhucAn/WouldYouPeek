import type {
  CreatorDraftContent,
  CreatorScenarioSnapshot,
  ReviewChecklist,
} from "@/contracts/creator";
import { REVIEW_CHECKLIST_KEYS } from "@/contracts/creator";
import { validatePublishContent } from "@/lib/creator/content";
import vectors from "../../fixtures/creator-content-cases.json";
export const creatorScenarioId = "55555555-5555-4555-8555-555555555555";
export const creatorReviewId = "66666666-6666-4666-8666-666666666666";
export function validCreatorContent(): CreatorDraftContent {
  return structuredClone(vectors.validContent) as CreatorDraftContent;
}
export function checkedReview(): ReviewChecklist {
  return Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((k) => [k, true]),
  ) as ReviewChecklist;
}
export function creatorSnapshot(
  content = validCreatorContent(),
): CreatorScenarioSnapshot {
  const issues = validatePublishContent(content);
  return {
    id: creatorScenarioId,
    revision: 1,
    draft: { revision: 1, content, savedAt: "2026-11-18T00:00:00Z" },
    readiness: { canReview: issues.length === 0, issues },
    review: null,
    publication: {
      operatorVisibility: { hidden: false, reason: null, changedAt: null },
      state: "never_published",
      currentVersion: null,
      publishedAt: null,
      hasUnpublishedChanges: true,
    },
    updatedAt: "2026-11-18T00:00:00Z",
  };
}
