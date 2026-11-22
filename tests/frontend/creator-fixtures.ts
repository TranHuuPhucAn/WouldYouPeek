import type {
  CreatorDraftContent,
  CreatorScenarioSnapshot,
  CreatorReviewPreview,
  CreatorScenarioSummary,
  ReviewChecklist,
} from "@/contracts/creator";
import { REVIEW_CHECKLIST_KEYS } from "@/contracts/creator";
import type { AnswerResponse, ChallengeDetail } from "@/contracts/challenge";
import type { LibraryScenarioPreview } from "@/contracts/library";
import cases from "../fixtures/creator-content-cases.json";
import {
  createEmptyDraft,
  validatePublishContent,
} from "@/lib/creator/content";
export const creatorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const reviewId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const commandId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const when = "2026-11-18T02:00:00.000Z";
export const allChecked = () =>
  Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((key) => [key, true]),
  ) as ReviewChecklist;
export const validContent = () =>
  structuredClone(cases.validContent) as CreatorDraftContent;
export function creatorSnapshot(
  complete = true,
  reviewed = false,
): CreatorScenarioSnapshot {
  const content = complete ? validContent() : createEmptyDraft();
  const issues = validatePublishContent(content);
  return {
    id: creatorId,
    revision: reviewed ? 2 : 1,
    draft: { revision: 1, content, savedAt: when },
    readiness: { issues, canReview: !issues.length },
    review: reviewed
      ? {
          id: reviewId,
          draftRevision: 1,
          reviewedAt: when,
          checklist: allChecked(),
        }
      : null,
    publication: {
      state: "never_published",
      currentVersion: null,
      publishedAt: null,
      hasUnpublishedChanges: false,
      operatorVisibility: { hidden: false, reason: null, changedAt: null },
    },
    updatedAt: when,
  };
}
export function creatorSummary(s = creatorSnapshot()): CreatorScenarioSummary {
  return {
    id: s.id,
    title: s.draft.content.title,
    revision: s.revision,
    draftRevision: s.draft.revision,
    canReview: s.readiness.canReview,
    reviewed: !!s.review,
    publication: s.publication,
    createdAt: when,
    updatedAt: when,
  };
}
export function creatorPreview(s = creatorSnapshot()): CreatorReviewPreview {
  const c = s.draft.content;
  if (c.source.kind === "uploaded")
    throw new Error("creatorPreview expects a YouTube fixture source");
  const videoId = "_yPrykaB2nE";
  const challenge: ChallengeDetail = {
    id: s.id,
    title: c.title,
    topic: c.topic,
    order: 1,
    mediaStatus: "ready",
    contentVersion: `draft-${s.draft.revision}`,
    context: c.context,
    question: c.question,
    knownFacts: c.knownFacts,
    unknowns: c.unknowns,
    source: {
      ...c.source,
      kind: "youtube",
      videoId,
      matchType: c.source.matchType!,
      side: c.source.side!,
      round: c.source.round!,
    },
    setup: {
      kind: "youtube",
      videoId,
      startSeconds: c.media.startSeconds!,
      endSeconds: c.media.decisionSeconds!,
      alt: c.media.setupAlt,
    },
    decision: {
      kind: "paused-video",
      atSeconds: c.media.decisionSeconds!,
      alt: c.media.decisionAlt,
    },
    options: c.options.map(({ id, label }) => ({ id, label })),
  };
  const feedbackByOption = Object.fromEntries(
    c.options.map((option) => [
      option.id,
      {
        challengeId: s.id,
        contentVersion: challenge.contentVersion,
        selectedOptionId: option.id,
        selectedAssessment: option.assessment!,
        recommendedOptionIds: c.options
          .filter((o) => o.assessment === "recommended")
          .map((o) => o.id),
        optionFeedback: c.options.map((o) => ({
          optionId: o.id,
          assessment: o.assessment!,
          explanation: o.explanation,
          acceptableWhen: o.acceptableWhen,
          risks: o.risks,
        })),
        takeaway: c.takeaway,
        reveal: {
          kind: "youtube",
          videoId,
          startSeconds: c.media.decisionSeconds!,
          endSeconds: c.media.endSeconds!,
          alt: c.media.revealAlt,
        },
        outcomeText: c.outcomeText,
        observedAction: {
          ...c.observedAction,
          optionId: c.observedAction.optionId!,
        },
        matchesPro: option.id === c.observedAction.optionId,
        analysis: {
          ...c.analysis,
          notice:
            "Creator interpretation, not a statement of the player’s intent.",
        },
      } satisfies AnswerResponse,
    ]),
  );
  return { scenario: s, challenge, feedbackByOption };
}
export function libraryEntry(): LibraryScenarioPreview {
  const {
    id,
    title,
    topic,
    order,
    mediaStatus,
    context,
    source,
    setup,
    contentVersion,
  } = creatorPreview().challenge;
  return {
    id,
    title,
    topic,
    order,
    mediaStatus,
    context,
    source,
    setup,
    contentVersion,
    player: { id: "76af0a04-4751-4d26-9233-183a252e124b", displayName: "TenZ" },
    editorialOrigin: "creator",
    provenance: "creator",
    publishedAt: when,
  };
}
export function selectedSnapshot(
  phase: import("@/contracts/session").SessionSnapshot["phase"] = "setup",
): import("@/contracts/session").SessionSnapshot {
  const p = creatorPreview();
  const option = p.challenge.options[0].id;
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    target: { kind: "scenario", scenarioId: creatorId },
    title: p.challenge.title,
    status:
      phase === "completed"
        ? "completed"
        : phase === "ended"
          ? "ended"
          : "in_progress",
    phase,
    revision:
      phase === "setup" ? 0 : phase === "review" || phase === "ended" ? 1 : 2,
    currentIndex: phase === "completed" || phase === "ended" ? null : 0,
    createdAt: when,
    updatedAt: when,
    completedAt: phase === "completed" ? when : null,
    endedAt: phase === "ended" ? when : null,
    items: [
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        position: 0,
        challenge: p.challenge,
        answer:
          phase === "setup" || phase === "ended"
            ? null
            : {
                id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                answeredAt: when,
                result: p.feedbackByOption[option],
              },
      },
    ],
  };
}
