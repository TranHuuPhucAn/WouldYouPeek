import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  startOrResumeSession: vi.fn(),
  findSession: vi.fn(),
  listSessions: vi.fn(),
  submitSessionAnswer: vi.fn(),
  advanceSession: vi.fn(),
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
});
