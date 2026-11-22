import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  findActiveSessionSummary: vi.fn(),
  startOrResumeSession: vi.fn(),
  findSession: vi.fn(),
  listSessions: vi.fn(),
  submitSessionAnswer: vi.fn(),
  advanceSession: vi.fn(),
  endSession: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({ requireVerifiedUser: mocks.guard }));
vi.mock("@/server/training/repository", () => mocks);
import * as service from "@/server/training/service";
import {
  snapshot,
  reviewSnapshot,
  sessionId,
  requestId,
} from "./helpers/session";
import { ApiError } from "@/server/http";
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.guard.mockResolvedValue({ id: "u" });
});
describe("training service boundaries", () => {
  it("returns canonical start/resume response", async () => {
    mocks.startOrResumeSession.mockResolvedValue({
      session: snapshot(),
      created: false,
      replayed: true,
    });
    expect(await service.startSession({ requestId })).toMatchObject({
      created: false,
      replayed: true,
    });
    expect(mocks.startOrResumeSession).toHaveBeenCalledWith(requestId);
  });
  it("never touches storage before authorization", async () => {
    mocks.guard.mockRejectedValue(new ApiError("AUTH_REQUIRED", "Sign in"));
    await expect(service.startSession({ requestId })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
    await expect(
      service.endSession(sessionId, { requestId, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(mocks.endSession).not.toHaveBeenCalled();
  });
  it("projects the owned terminal result and rejects malformed end commands", async () => {
    const ended = {
      ...snapshot(),
      status: "ended",
      phase: "ended",
      currentIndex: null,
      revision: 1,
      updatedAt: "2026-01-01T00:02:00Z",
      endedAt: "2026-01-01T00:02:00Z",
    };
    mocks.endSession.mockResolvedValue({ session: ended, replayed: true });
    const command = { requestId, expectedRevision: 0 };
    expect(await service.endSession(sessionId, command)).toEqual({
      session: ended,
      replayed: true,
    });
    expect(mocks.endSession).toHaveBeenCalledWith(sessionId, command);
    mocks.endSession.mockClear();
    for (const input of [
      null,
      [],
      {},
      { ...command, ownerId: "other" },
      { ...command, expectedRevision: 2_147_483_648 },
      { ...command, requestId: "bad" },
    ]) {
      await expect(service.endSession(sessionId, input)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    }
    expect(mocks.endSession).not.toHaveBeenCalled();
  });
  it("does not accept user-supplied grading", async () => {
    await expect(
      service.answerSessionItem(sessionId, snapshot().items[0].id, {
        requestId,
        optionId: "hold-exit",
        expectedRevision: 0,
        assessment: "recommended",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(mocks.submitSessionAnswer).not.toHaveBeenCalled();
  });
  it("preserves final review on load and answers", async () => {
    mocks.findSession.mockResolvedValue(reviewSnapshot(2));
    expect(await service.getSession(sessionId)).toMatchObject({
      phase: "review",
      currentIndex: 2,
    });
    mocks.submitSessionAnswer.mockResolvedValue({
      session: reviewSnapshot(),
      replayed: false,
    });
    expect(
      await service.answerSessionItem(sessionId, snapshot().items[0].id, {
        requestId,
        optionId: "use-meddle",
        expectedRevision: 0,
      }),
    ).toMatchObject({ session: { phase: "review" } });
  });
  it("preserves RPC ownership/revision conflicts instead of falling back", async () => {
    mocks.findSession.mockRejectedValue(
      new ApiError("SESSION_NOT_FOUND", "Missing"),
    );
    await expect(service.getSession(sessionId)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    mocks.advanceSession.mockRejectedValue(
      new ApiError("SESSION_CONFLICT", "Changed"),
    );
    await expect(
      service.advanceSession(sessionId, {
        requestId,
        fromItemId: snapshot().items[0].id,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "SESSION_CONFLICT" });
  });
  it("validates opaque own-history cursor and returned projection", async () => {
    mocks.listSessions.mockResolvedValue({ sessions: [], nextCursor: null });
    expect(await service.getHistory()).toEqual({
      sessions: [],
      nextCursor: null,
    });
    expect(mocks.listSessions).toHaveBeenCalledWith(null);
  });
  it("loads only a verified active summary and does not start a session", async () => {
    mocks.findActiveSessionSummary.mockResolvedValue(null);
    expect(await service.getActiveSessionSummary()).toBeNull();
    expect(mocks.startOrResumeSession).not.toHaveBeenCalled();
    const session = snapshot();
    const summary = {
      id: session.id,
      status: "in_progress",
      answeredCount: 0,
      totalCount: 1,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: null,
      endedAt: null,
      target: { kind: "scenario", scenarioId: "bind-clove-utility-window" },
      title: "Saved scenario",
    };
    mocks.findActiveSessionSummary.mockResolvedValue({
      ...summary,
      answerKey: "private",
    });
    expect(await service.getActiveSessionSummary()).toEqual(summary);
    mocks.guard.mockRejectedValue(new ApiError("EMAIL_NOT_VERIFIED", "Verify"));
    mocks.findActiveSessionSummary.mockClear();
    await expect(service.getActiveSessionSummary()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
    expect(mocks.findActiveSessionSummary).not.toHaveBeenCalled();
  });
});
