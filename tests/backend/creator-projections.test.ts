import { describe, expect, it } from "vitest";
import {
  toCreatorSnapshot,
  toCreatorMutation,
  toCreatorList,
} from "@/server/creator/projections";
import {
  creatorSnapshot,
  checkedReview,
  creatorReviewId,
} from "./helpers/creator";
describe("owner DTO projections", () => {
  it("projects only intended metadata and retains a typed private draft", () => {
    const source = creatorSnapshot();
    expect(
      toCreatorSnapshot({
        ...source,
        email: "private@example.test",
        commands: [{ secret: true }],
      }),
    ).toEqual(source);
  });
  it("fails closed on stale or fabricated review state", () => {
    const source = creatorSnapshot();
    source.review = {
      id: creatorReviewId,
      draftRevision: 1,
      reviewedAt: source.updatedAt,
      checklist: checkedReview(),
    };
    expect(toCreatorSnapshot(source).review?.id).toBe(creatorReviewId);
    source.review.draftRevision = 0;
    expect(() => toCreatorSnapshot(source)).toThrow();
    source.review.draftRevision = 1;
    source.review.checklist.pauseTimingChecked = false;
    expect(() => toCreatorSnapshot(source)).toThrow();
  });
  it("keeps the original publication receipt distinct from a newer live version", () => {
    const source = creatorSnapshot();
    source.publication = {
      operatorVisibility: { hidden: false, reason: null, changedAt: null },
      state: "published",
      currentVersion: "creator-2",
      publishedAt: source.updatedAt,
      hasUnpublishedChanges: false,
    };
    const result = toCreatorMutation({
      scenario: source,
      replayed: true,
      publishedVersion: "creator-1",
    });
    expect(result.publishedVersion).toBe("creator-1");
    expect(result.scenario.publication.currentVersion).toBe("creator-2");
  });
  it("rejects corrupt nested content and publication relations", () => {
    const source = creatorSnapshot();
    expect(() =>
      toCreatorSnapshot({
        ...source,
        draft: {
          ...source.draft,
          content: { ...source.draft.content, privateOwner: true },
        },
      }),
    ).toThrow();
    expect(() =>
      toCreatorSnapshot({
        ...source,
        publication: { ...source.publication, state: "published" },
      }),
    ).toThrow();
    expect(() =>
      toCreatorList({ scenarios: "bad", nextCursor: null }),
    ).toThrow();
  });
});
