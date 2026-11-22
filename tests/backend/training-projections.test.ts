import { describe, it, expect } from "vitest";
import {
  toSessionSnapshot,
  toSessionSummary,
  toChallengePreview,
  toSavedAnswer,
} from "@/server/training/projections";
import { snapshot, reviewSnapshot, sessionId } from "./helpers/session";
describe("safe canonical database projections", () => {
  function ended(answered = 1, fromSetup = false) {
    const result = answered ? reviewSnapshot(answered - 1) : snapshot();
    result.phase = "ended";
    result.status = "ended";
    result.currentIndex = null;
    result.revision = answered * 2 + (fromSetup || answered === 0 ? 1 : 0);
    result.endedAt = result.updatedAt = "2026-01-01T00:02:00Z";
    return result;
  }
  it("projects zero and partial endings with exact revision and preserved answers", () => {
    for (const value of [ended(0), ended(1), ended(1, true), ended(2)]) {
      expect(toSessionSnapshot(value)).toEqual(value);
      const { items, phase, revision, currentIndex, ...summary } = value;
      expect(
        toSessionSummary({
          ...summary,
          answeredCount: items.filter((i) => i.answer).length,
          totalCount: items.length,
        }),
      ).toMatchObject({
        status: "ended",
        endedAt: value.endedAt,
        completedAt: null,
      });
    }
  });
  it.each([
    { revision: 0 },
    { revision: 99 },
    { currentIndex: 0 },
    { completedAt: "2026-01-01T00:02:00Z" },
    { endedAt: null },
    { endedAt: "2025-01-01T00:02:00Z" },
    { status: "completed" },
  ])("rejects malformed ended state %j", (patch) => {
    expect(() => toSessionSnapshot({ ...ended(), ...patch })).toThrow();
  });
  it("rejects zero-answer even revision, ended answer gaps and full-answer endings", () => {
    expect(() => toSessionSnapshot({ ...ended(0), revision: 0 })).toThrow();
    const gap = ended(2);
    gap.items[0].answer = null;
    expect(() => toSessionSnapshot(gap)).toThrow();
    expect(() => toSessionSnapshot(ended(3))).toThrow();
    const future = ended();
    future.items[0].answer!.answeredAt = "2026-01-01T00:03:00Z";
    expect(() => toSessionSnapshot(future)).toThrow();
  });
  it("accepts setup and final review without completing it", () => {
    expect(toSessionSnapshot(snapshot())).toEqual(snapshot());
    expect(toSessionSnapshot(reviewSnapshot(2))).toMatchObject({
      phase: "review",
      status: "in_progress",
      currentIndex: 2,
      revision: 5,
      completedAt: null,
      endedAt: null,
    });
  });
  it("removes internal fields at every content boundary", () => {
    const input = reviewSnapshot() as ReturnType<typeof snapshot> & {
      userId: string;
    };
    input.userId = "private";
    Object.assign(input.items[0].challenge, { privateReview: "secret" });
    Object.assign(input.items[0].challenge.source!, { secret: "secret" });
    Object.assign(input.items[0].answer!.result, { privateReview: "secret" });
    const output = JSON.stringify(toSessionSnapshot(input));
    expect(output).not.toContain("privateReview");
    expect(output).not.toContain('"userId"');
    expect(output).not.toContain("secret");
  });
  it("projects preview from full content without exposing choices", () => {
    const preview = toChallengePreview(reviewSnapshot().items[0].challenge);
    expect(Object.keys(preview).sort()).toEqual([
      "context",
      "id",
      "mediaStatus",
      "order",
      "setup",
      "source",
      "title",
      "topic",
    ]);
  });
  it.each(["revision", "currentIndex", "phase", "status"])(
    "fails closed on bad %s",
    (field) => {
      const input = snapshot();
      Object.assign(input, { [field]: "invalid" });
      expect(() => toSessionSnapshot(input)).toThrow();
    },
  );
  it("rejects an answer leaked into a future scenario", () => {
    const input = reviewSnapshot(1);
    input.phase = "setup";
    input.currentIndex = 0;
    input.revision = 0;
    expect(() => toSessionSnapshot(input)).toThrow();
  });
  it("rejects missing review answer and duplicate item identifiers", () => {
    const input = reviewSnapshot();
    input.items[0].answer = null;
    expect(() => toSessionSnapshot(input)).toThrow();
    const duplicate = snapshot();
    duplicate.items[1].id = duplicate.items[0].id;
    expect(() => toSessionSnapshot(duplicate)).toThrow();
  });
  it("rejects mismatched persisted answer version", () => {
    const input = reviewSnapshot();
    input.items[0].answer!.result.contentVersion = "different";
    expect(() =>
      toSavedAnswer(input.items[0].answer, input.items[0].challenge),
    ).toThrow();
  });
  it("accepts explicit completion only with all answers", () => {
    const input = reviewSnapshot(2);
    Object.assign(input, {
      phase: "completed",
      status: "completed",
      currentIndex: null,
      revision: 6,
      completedAt: "2026-01-01T00:02:00Z",
    });
    expect(toSessionSnapshot(input)).toEqual(input);
    input.items[2].answer = null;
    expect(() => toSessionSnapshot(input)).toThrow();
  });
  it("rejects impossible history counts", () =>
    expect(() =>
      toSessionSummary({
        id: sessionId,
        status: "completed",
        answeredCount: 2,
        totalCount: 3,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        completedAt: "2026-01-01",
      }),
    ).toThrow());
});
