import { describe, expect, it, vi } from "vitest";
import {
  parseSessionSnapshot,
  validateSessionContinuity,
  parseSessionHistory,
  getSession,
  answerSessionItem,
  advanceSession,
  createOrResumeSession,
} from "@/lib/client/session-api";
import { snapshot, sessionSummary, sessionId } from "./session-fixtures";
describe("saved session API boundary", () => {
  it.each(["setup", "review", "completed"] as const)(
    "accepts coherent %s",
    (phase) =>
      expect(parseSessionSnapshot(snapshot(phase))).toEqual(snapshot(phase)),
  );
  it.each([
    (s: ReturnType<typeof snapshot>) => ({ ...s, id: "invalid" }),
    (s: ReturnType<typeof snapshot>) => ({ ...s, revision: 1 }),
    (s: ReturnType<typeof snapshot>) => ({ ...s, currentIndex: 99 }),
    (s: ReturnType<typeof snapshot>) => ({ ...s, phase: "review" }),
    (s: ReturnType<typeof snapshot>) => ({
      ...s,
      items: [s.items[0], s.items[0]],
    }),
    (s: ReturnType<typeof snapshot>) => ({
      ...s,
      items: snapshot("review").items,
    }),
  ])("rejects corrupt identity/checkpoint/answer payload %#", (mutate) =>
    expect(() => parseSessionSnapshot(mutate(snapshot()))).toThrow(),
  );
  it("rejects historical version mismatches", () => {
    const s = snapshot("review");
    s.items[0].answer!.result.contentVersion = "wrong";
    expect(() => parseSessionSnapshot(s)).toThrow();
  });
  it("rejects wrong requested session and answer item", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            ...snapshot(),
            id: "55555555-5555-4555-8555-555555555555",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ session: snapshot("review"), replayed: false }),
        ),
    );
    await expect(getSession(sessionId)).rejects.toThrow();
    await expect(
      answerSessionItem(sessionId, snapshot().items[1].id, {
        optionId: "hold",
        requestId: sessionId,
        expectedRevision: 0,
      }),
    ).rejects.toThrow();
  });
  it("requires acknowledgement of advancement", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ session: snapshot("review"), replayed: false }),
        ),
    );
    await expect(
      advanceSession(sessionId, {
        fromItemId: snapshot().items[0].id,
        requestId: sessionId,
        expectedRevision: 1,
      }),
    ).rejects.toThrow();
  });
  it("uses private no-store mutations and forwards stable command IDs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ session: snapshot(), replayed: true, created: true }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await createOrResumeSession({ requestId: sessionId })).replayed,
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/sessions",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ requestId: sessionId }),
      }),
    );
  });
  it("validates paginated history counts and duplicate IDs", () => {
    expect(
      parseSessionHistory({ sessions: [sessionSummary()], nextCursor: null })
        .sessions,
    ).toHaveLength(1);
    expect(() =>
      parseSessionHistory({
        sessions: [sessionSummary(), sessionSummary()],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parseSessionHistory({
        sessions: [{ ...sessionSummary(), answeredCount: 4 }],
        nextCursor: null,
      }),
    ).toThrow();
  });
});

it("rejects malformed commands before sending them", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    createOrResumeSession({ requestId: "not-a-uuid" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    answerSessionItem(sessionId, snapshot().items[0].id, {
      optionId: "hold",
      requestId: sessionId,
      expectedRevision: -1,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects replacement content versions and changed already-saved choices", () => {
  const before = snapshot();
  const after = snapshot("review");
  after.items = structuredClone(after.items);
  after.items[0].challenge.contentVersion = "replacement";
  expect(() => validateSessionContinuity(after, before)).toThrow();
  const saved = snapshot("review");
  const altered = structuredClone(saved);
  altered.items[0].answer!.result.selectedOptionId = "peek";
  expect(() => validateSessionContinuity(altered, saved)).toThrow();
});
