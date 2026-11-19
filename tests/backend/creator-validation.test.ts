import { describe, expect, it } from "vitest";
import * as v from "@/server/creator/validation";
import {
  checkedReview,
  creatorReviewId,
  creatorScenarioId,
  validCreatorContent,
} from "./helpers/creator";
import { requestId } from "./helpers/session";
describe("creator command boundaries", () => {
  it("rejects owner, version and flag injection into commands or content", () => {
    for (const extra of [
      "ownerId",
      "is_demo",
      "currentVersion",
      "reviewerId",
    ]) {
      expect(() =>
        v.parseCreateDraft({ requestId, [extra]: creatorScenarioId }),
      ).toThrow();
      expect(() =>
        v.parseSaveDraft({
          requestId,
          expectedRevision: 1,
          content: { ...validCreatorContent(), [extra]: true },
        }),
      ).toThrow();
    }
  });
  it("requires exact command fields, bounded revisions and complete acknowledgement", () => {
    expect(v.parseCreateDraft({ requestId })).toEqual({ requestId });
    expect(
      v.parsePublishCommand({
        requestId,
        expectedRevision: 2,
        reviewId: creatorReviewId,
      }),
    ).toMatchObject({ reviewId: creatorReviewId });
    expect(
      v.parseUnpublishCommand({ requestId, expectedRevision: 3 }),
    ).toMatchObject({ expectedRevision: 3 });
    for (const revision of [-1, 1.2, Number.NaN, "1", null, 2_147_483_648])
      expect(() =>
        v.parseSaveDraft({
          requestId,
          expectedRevision: revision,
          content: validCreatorContent(),
        }),
      ).toThrow();
    expect(() =>
      v.parseReviewCommand({
        requestId,
        expectedRevision: 1,
        checklist: { ...checkedReview(), normalSpeedAudioChecked: false },
      }),
    ).toThrow();
    expect(() =>
      v.parseReviewCommand({
        requestId,
        expectedRevision: 1,
        checklist: { ...checkedReview(), forged: true },
      }),
    ).toThrow();
    expect(
      v.parseReviewCommand({
        requestId,
        expectedRevision: 1,
        checklist: checkedReview(),
      }).checklist,
    ).toEqual(checkedReview());
    expect(v.parseReviewRevision("12")).toBe(12);
    expect(() => v.parseReviewRevision("1.2")).toThrow();
  });
  it("saves incomplete valid content while normalizing source aliases", () => {
    const content = validCreatorContent();
    content.title = "";
    content.source.url = "https://youtu.be/_yPrykaB2nE?t=90";
    const result = v.parseSaveDraft({
      requestId,
      expectedRevision: 0,
      content,
    });
    expect(result.content.title).toBe("");
    expect(result.content.source.url).toBe(
      "https://www.youtube.com/watch?v=_yPrykaB2nE",
    );
  });
  it("binds pagination to valid stable tuples and the selected filter", () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: "2026-11-18T00:00:00Z",
        id: creatorScenarioId,
        status: "published",
      }),
    ).toString("base64url");
    expect(v.parseCreatorCursor(cursor, "published")).toBe(cursor);
    expect(() => v.parseCreatorCursor(cursor, "withdrawn")).toThrow();
    expect(() => v.parseCreatorCursor("a".repeat(1025))).toThrow();
    expect(() => v.parseCreatorCursor("%not-json")).toThrow();
    expect(v.parseCreatorFilter(null)).toBe("all");
    expect(() => v.parseCreatorFilter(["all"])).toThrow();
  });
});
