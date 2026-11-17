import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import * as api from "@/lib/client/challenge-api";
import { answerFor, challenges, summaries } from "./fixtures";

vi.mock("@/lib/client/challenge-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/challenge-api")>()),
  getChallenges: vi.fn(),
  getChallenge: vi.fn(),
  submitAnswer: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.getChallenges).mockReset().mockResolvedValue(summaries);
  vi.mocked(api.getChallenge)
    .mockReset()
    .mockImplementation(async (id) =>
      challenges.find((challenge) => challenge.id === id)!,
    );
  vi.mocked(api.submitAnswer).mockReset().mockResolvedValue(answerFor());
});

describe("session request coordination", () => {
  it("loads catalogue before the first detail and recovers from a detail failure", async () => {
    vi.mocked(api.getChallenge).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(useChallengeSession);
    await waitFor(() => expect(result.current.state.phase).toBe("error"));
    expect(result.current.state.error).toBe("Offline");
    expect(api.getChallenges).toHaveBeenCalledTimes(1);
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.state.phase).toBe("setup"));
    expect(api.getChallenge).toHaveBeenCalledTimes(2);
    expect(api.getChallenges).toHaveBeenCalledTimes(1);
  });
  it("suppresses immediate duplicate submissions and allows retry after failure", async () => {
    let rejectAnswer!: (error: Error) => void;
    vi.mocked(api.submitAnswer).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectAnswer = reject;
        }),
    );
    const { result } = renderHook(useChallengeSession);
    await waitFor(() => expect(result.current.state.phase).toBe("setup"));
    act(() => result.current.completeSetup());
    act(() => result.current.selectOption("hold"));
    let first!: Promise<void>;
    act(() => {
      first = result.current.submitSelection();
      void result.current.submitSelection();
    });
    expect(api.submitAnswer).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("submitting");
    await act(async () => {
      rejectAnswer(new Error("Try again"));
      await first;
    });
    expect(result.current.state.phase).toBe("decision");
    expect(result.current.state.selectedOptionId).toBe("hold");
    expect(result.current.state.completed).toHaveLength(0);
    await act(async () => {
      await result.current.submitSelection();
    });
    expect(api.submitAnswer).toHaveBeenCalledTimes(2);
    expect(result.current.state.phase).toBe("review");
  });
  it("aborts in-flight loading on unmount and ignores late results", async () => {
    let resolveList!: (value: typeof summaries) => void;
    vi.mocked(api.getChallenges).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const { unmount } = renderHook(useChallengeSession);
    const signal = vi.mocked(api.getChallenges).mock.calls[0][0]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveList(summaries);
    });
    expect(api.getChallenge).not.toHaveBeenCalled();
  });
  it("cancels an answer on restart so a late success cannot complete the fresh session", async () => {
    let resolveAnswer!: (answer: ReturnType<typeof answerFor>) => void;
    vi.mocked(api.submitAnswer).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAnswer = resolve;
        }),
    );
    const { result } = renderHook(useChallengeSession);
    await waitFor(() => expect(result.current.state.phase).toBe("setup"));
    act(() => result.current.completeSetup());
    act(() => result.current.selectOption("hold"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submitSelection();
    });
    const signal = vi.mocked(api.submitAnswer).mock.calls[0][2]!;
    act(() => result.current.restart());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveAnswer(answerFor());
      await pending;
    });
    await waitFor(() => expect(result.current.state.phase).toBe("setup"));
    expect(result.current.state.completed).toHaveLength(0);
    expect(result.current.state.feedback).toBeNull();
  });
  it("keeps the decision recoverable when feedback does not match the loaded content", async () => {
    vi.mocked(api.submitAnswer).mockResolvedValueOnce({
      ...answerFor(),
      contentVersion: "stale",
    });
    const { result } = renderHook(useChallengeSession);
    await waitFor(() => expect(result.current.state.phase).toBe("setup"));
    act(() => result.current.completeSetup());
    act(() => result.current.selectOption("hold"));
    await act(async () => {
      await result.current.submitSelection();
    });
    expect(result.current.state.phase).toBe("decision");
    expect(result.current.state.selectedOptionId).toBe("hold");
    expect(result.current.state.completed).toHaveLength(0);
    expect(result.current.state.error).toMatch(/incomplete/);
  });
});
