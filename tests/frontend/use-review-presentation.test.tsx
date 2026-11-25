import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useReviewPresentation } from "@/hooks/use-review-presentation";
import type { ReviewPresentationInput } from "@/lib/session/review-presentation";

const initial: ReviewPresentationInput = {
  scopeKey: "viewer/session/item/version",
  answerKey: null,
  mode: "setup",
};
const saved: ReviewPresentationInput = {
  ...initial,
  answerKey: "saved-answer",
  mode: "reveal",
};

describe("useReviewPresentation", () => {
  it("waits for the newly saved continuation and exposes a hydrated answer immediately", () => {
    const { result, rerender, unmount } = renderHook(useReviewPresentation, {
      initialProps: initial,
    });
    const eventHandler = result.current.onPlaybackEvent;
    rerender(saved);
    expect(result.current.analysisVisible).toBe(false);
    expect(result.current.autoplay).toBe(true);
    expect(result.current.onPlaybackEvent).toBe(eventHandler);
    act(() =>
      result.current.onPlaybackEvent({
        playbackKey: result.current.playbackKey,
        mode: "reveal",
        type: "complete",
      }),
    );
    expect(result.current.analysisVisible).toBe(true);
    rerender({ ...saved });
    expect(result.current.analysisVisible).toBe(true);
    unmount();
    const resumed = renderHook(useReviewPresentation, { initialProps: saved });
    expect(resumed.result.current.analysisVisible).toBe(true);
    expect(resumed.result.current.autoplay).toBe(false);
  });

  it("never returns a preceding item's open analysis during a scope change", () => {
    const renders: boolean[] = [];
    const { rerender } = renderHook(
      (input: ReviewPresentationInput) => {
        const view = useReviewPresentation(input);
        renders.push(view.analysisVisible);
        return view;
      },
      { initialProps: saved },
    );
    renders.length = 0;
    rerender({ ...initial, scopeKey: "next-item" });
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every((visible) => visible === false)).toBe(true);
  });

  it("ignores stale player and explicit-action callbacks after replacing scope", () => {
    const { result, rerender } = renderHook(useReviewPresentation, {
      initialProps: initial,
    });
    rerender(saved);
    const previous = result.current;
    rerender({ ...initial, scopeKey: "new-item" });
    rerender({ ...saved, scopeKey: "new-item", answerKey: "new-answer" });
    const key = result.current.playbackKey;
    act(() => {
      previous.onPlaybackEvent({
        playbackKey: previous.playbackKey,
        mode: "reveal",
        type: "complete",
      });
      previous.showAnalysis();
      previous.restartPlayback();
    });
    expect(result.current.analysisVisible).toBe(false);
    expect(result.current.playbackKey).toBe(key);
  });

  it("offers saved analysis during blocked playback, pauses intent, then allows explicit replay", () => {
    const { result, rerender } = renderHook(useReviewPresentation, {
      initialProps: initial,
    });
    rerender(saved);
    act(() =>
      result.current.onPlaybackEvent({
        playbackKey: result.current.playbackKey,
        mode: "reveal",
        type: "blocked",
      }),
    );
    expect(result.current.status).toBe("blocked");
    expect(result.current.analysisVisible).toBe(false);
    act(() => result.current.showAnalysis());
    expect(result.current.analysisVisible).toBe(true);
    expect(result.current.autoplay).toBe(false);
    const key = result.current.playbackKey;
    act(() => result.current.restartPlayback());
    expect(result.current.playbackKey).not.toBe(key);
    expect(result.current.autoplay).toBe(true);
    expect(result.current.analysisVisible).toBe(true);
  });

  it("does not expose a pending choice through explicit read", () => {
    const { result } = renderHook(useReviewPresentation, {
      initialProps: { ...initial, mode: "decision" as const },
    });
    act(() => result.current.showAnalysis());
    expect(result.current.analysisVisible).toBe(false);
  });

  it("keeps a saved review readable across replay mode changes and ignores the preceding mode", () => {
    const { result, rerender } = renderHook(useReviewPresentation, {
      initialProps: saved,
    });
    const previousKey = result.current.playbackKey;
    act(() => result.current.restartPlayback());
    rerender({ ...saved, mode: "review-setup" });
    act(() =>
      result.current.onPlaybackEvent({
        playbackKey: previousKey,
        mode: "reveal",
        type: "complete",
      }),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.analysisVisible).toBe(true);
    expect(result.current.autoplay).toBe(true);
  });

  it("opts into playback only for an intentional saved recap mount", () => {
    const { result } = renderHook(useReviewPresentation, {
      initialProps: { ...saved, autoplayOnMount: true },
    });
    expect(result.current.analysisVisible).toBe(true);
    expect(result.current.autoplay).toBe(true);
  });
});
