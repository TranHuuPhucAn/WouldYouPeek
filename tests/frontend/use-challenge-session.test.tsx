import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import * as api from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import { snapshot, viewer } from "./session-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
vi.mock("@/lib/client/session-api", () => ({
  answerSessionItem: vi.fn(),
  advanceSession: vi.fn(),
  getSession: vi.fn(),
  createOrResumeSession: vi.fn(),
  validateSessionContinuity: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(api.answerSessionItem)
    .mockReset()
    .mockResolvedValue({ session: snapshot("review"), replayed: false });
  vi.mocked(api.getSession).mockReset().mockResolvedValue(snapshot());
  vi.mocked(api.advanceSession)
    .mockReset()
    .mockResolvedValue({ session: snapshot("setup", 1), replayed: false });
});
function ready() {
  const view = renderHook(() => useChallengeSession(snapshot(), viewer.id));
  act(() => view.result.current.completeSetup());
  act(() => view.result.current.selectOption("hold"));
  return view;
}
describe("durable command coordination", () => {
  it("suppresses duplicate clicks and reveals only after save confirmation", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.answerSessionItem>>,
    ) => void;
    vi.mocked(api.answerSessionItem).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const { result } = ready();
    act(() => {
      void result.current.submitSelection();
      void result.current.submitSelection();
    });
    expect(api.answerSessionItem).toHaveBeenCalledTimes(1);
    expect(result.current.state.feedback).toBeNull();
    await act(async () =>
      resolve({ session: snapshot("review"), replayed: false }),
    );
    expect(result.current.state.phase).toBe("review");
  });
  it("reconciles a lost response before exposing the continuation", async () => {
    vi.mocked(api.answerSessionItem).mockRejectedValueOnce(
      new Error("Lost response"),
    );
    vi.mocked(api.getSession).mockResolvedValueOnce(snapshot("review"));
    const { result } = ready();
    await act(() => result.current.submitSelection());
    expect(result.current.state.phase).toBe("review");
    expect(api.answerSessionItem).toHaveBeenCalledTimes(1);
  });
  it("retains exactly the same command on retry after an uncertain save", async () => {
    vi.mocked(api.answerSessionItem).mockRejectedValueOnce(
      new Error("Offline"),
    );
    vi.mocked(api.getSession).mockRejectedValueOnce(new Error("Offline"));
    const { result } = ready();
    await act(() => result.current.submitSelection());
    expect(result.current.state.unresolved).toBe(true);
    expect(result.current.state.feedback).toBeNull();
    act(() => result.current.selectOption("peek"));
    await act(() => result.current.retrySave());
    expect(vi.mocked(api.answerSessionItem).mock.calls[1].slice(0, 3)).toEqual(
      vi.mocked(api.answerSessionItem).mock.calls[0].slice(0, 3),
    );
    expect(result.current.state.phase).toBe("review");
  });
  it("uses canonical state after a stale revision from another tab", async () => {
    vi.mocked(api.answerSessionItem).mockRejectedValueOnce(
      new ApiClientError("SESSION_CONFLICT", "Changed", 409),
    );
    vi.mocked(api.getSession).mockResolvedValueOnce(snapshot("setup", 1));
    const { result } = ready();
    await act(() => result.current.submitSelection());
    expect(result.current.state.currentIndex).toBe(1);
    expect(result.current.state.phase).toBe("setup");
  });
  it("keeps final feedback visible while Finish is failing and retries same ID", async () => {
    vi.mocked(api.advanceSession)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({
        session: snapshot("completed"),
        replayed: true,
      });
    vi.mocked(api.getSession).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(() =>
      useChallengeSession(snapshot("review", 2), viewer.id),
    );
    await act(() => result.current.advance());
    expect(result.current.state.phase).toBe("review");
    expect(result.current.state.feedback).toBeTruthy();
    await act(() => result.current.advance());
    expect(result.current.state.phase).toBe("complete");
    expect(vi.mocked(api.advanceSession).mock.calls[1][1]).toEqual(
      vi.mocked(api.advanceSession).mock.calls[0][1],
    );
  });
  it("aborts on unmount and never displays a late result", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.answerSessionItem>>,
    ) => void;
    vi.mocked(api.answerSessionItem).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const { result, unmount } = ready();
    act(() => {
      void result.current.submitSelection();
    });
    const signal = vi.mocked(api.answerSessionItem).mock.calls[0][3];
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      resolve({ session: snapshot("review"), replayed: false }),
    );
  });
  it("invalidates and aborts on account switch", async () => {
    vi.mocked(api.answerSessionItem).mockImplementation(
      () => new Promise(() => {}),
    );
    const { result } = ready();
    act(() => {
      void result.current.submitSelection();
    });
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(result.current.state.phase).toBe("auth-required");
    expect(vi.mocked(api.answerSessionItem).mock.calls[0][3]?.aborted).toBe(
      true,
    );
  });
  it("requires sign-in again on server auth expiry", async () => {
    vi.mocked(api.answerSessionItem).mockRejectedValueOnce(
      new ApiClientError("AUTH_REQUIRED", "Sign in", 401),
    );
    const { result } = ready();
    await act(() => result.current.submitSelection());
    expect(result.current.state.phase).toBe("auth-required");
    expect(result.current.state.feedback).toBeNull();
  });
  it("read-only replay makes no requests", () => {
    const { result } = renderHook(() =>
      useChallengeSession(snapshot("review"), viewer.id),
    );
    act(() => result.current.showReviewSetup());
    act(() => result.current.showReviewOutcome());
    expect(api.advanceSession).not.toHaveBeenCalled();
    expect(api.answerSessionItem).not.toHaveBeenCalled();
  });
  it("Play again creates a separate session and keeps retry ID", async () => {
    vi.mocked(api.createOrResumeSession)
      .mockRejectedValueOnce(new Error("Lost"))
      .mockResolvedValueOnce({
        session: { ...snapshot(), id: "55555555-5555-4555-8555-555555555555" },
        created: true,
        replayed: true,
      });
    const { result } = renderHook(() =>
      useChallengeSession(snapshot("completed"), viewer.id),
    );
    await act(() => result.current.createNextSession());
    await act(() => result.current.createNextSession());
    expect(vi.mocked(api.createOrResumeSession).mock.calls[1][0]).toEqual(
      vi.mocked(api.createOrResumeSession).mock.calls[0][0],
    );
    expect(router.push).toHaveBeenCalledWith(
      "/play/55555555-5555-4555-8555-555555555555",
    );
  });
});

describe("selected scenario replay", () => {
  it("starts the original scenario target again and retains its UUID on a lost response", async () => {
    const { selectedSnapshot } = await import("./creator-fixtures");
    const selected = selectedSnapshot("completed");
    vi.mocked(api.createOrResumeSession)
      .mockReset()
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockResolvedValueOnce({
        session: selectedSnapshot(),
        created: true,
        replayed: false,
      });
    const { result } = renderHook(() =>
      useChallengeSession(selected, viewer.id),
    );
    await act(() => result.current.createNextSession());
    await act(() => result.current.createNextSession());
    const calls = vi.mocked(api.createOrResumeSession).mock.calls;
    expect(calls[0][0].target).toEqual(selected.target);
    expect(calls[1][0]).toEqual(calls[0][0]);
  });
  it("retains the saved recap when a scenario has been withdrawn", async () => {
    const { selectedSnapshot } = await import("./creator-fixtures");
    vi.mocked(api.createOrResumeSession)
      .mockReset()
      .mockRejectedValueOnce(
        new ApiClientError("SCENARIO_UNAVAILABLE", "Unavailable", 404),
      );
    const { result } = renderHook(() =>
      useChallengeSession(selectedSnapshot("completed"), viewer.id),
    );
    await act(() => result.current.createNextSession());
    expect(result.current.state.phase).toBe("complete");
    expect(result.current.state.completed).toHaveLength(1);
    expect(result.current.state.error).toMatch(/no longer available/);
  });
});
