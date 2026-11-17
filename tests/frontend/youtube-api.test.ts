import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { YouTubeApi, YouTubeEvents } from "@/lib/video/youtube-api";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
});
afterEach(() => {
  document
    .querySelectorAll("script[data-peek-youtube-api]")
    .forEach((script) => script.remove());
  delete window.YT;
  delete window.onYouTubeIframeAPIReady;
  vi.useRealTimers();
});

describe("YouTube provider loader", () => {
  it("shares one load and preserves an existing ready callback", async () => {
    const previous = vi.fn();
    window.onYouTubeIframeAPIReady = previous;
    const { loadYouTubeApi } = await import("@/lib/video/youtube-api");
    const a = loadYouTubeApi();
    const b = loadYouTubeApi();
    expect(a).toBe(b);
    expect(
      document.querySelectorAll("script[data-peek-youtube-api]"),
    ).toHaveLength(1);
    const api = { Player: vi.fn() } as unknown as YouTubeApi;
    window.YT = api;
    window.onYouTubeIframeAPIReady?.();
    expect(await a).toBe(api);
    expect(previous).toHaveBeenCalledOnce();
    expect(await loadYouTubeApi()).toBe(api);
    expect(window.onYouTubeIframeAPIReady).toBe(previous);
  });
  it("recovers after a script error without leaving a poisoned promise", async () => {
    const { loadYouTubeApi } = await import("@/lib/video/youtube-api");
    const first = loadYouTubeApi();
    const failure = expect(first).rejects.toThrow(/couldn't connect/);
    document
      .querySelector("script[data-peek-youtube-api]")!
      .dispatchEvent(new Event("error"));
    await failure;
    const retry = loadYouTubeApi();
    expect(retry).not.toBe(first);
    window.YT = { Player: vi.fn() } as unknown as YouTubeApi;
    window.onYouTubeIframeAPIReady?.();
    await expect(retry).resolves.toBe(window.YT);
  });
  it("times out and permits retry", async () => {
    const { loadYouTubeApi } = await import("@/lib/video/youtube-api");
    const first = loadYouTubeApi();
    const failure = expect(first).rejects.toThrow(/couldn't connect/);
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(document.querySelector("script[data-peek-youtube-api]")).toBeNull();
    const retry = loadYouTubeApi();
    const nextFailure = expect(retry).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await nextFailure;
  });
  it("sets origin and supported parameters without downloading the footage", async () => {
    const { createYouTubePlayer } = await import("@/lib/video/youtube-api");
    const Player = vi.fn(function () {});
    const element = document.createElement("div");
    createYouTubePlayer(
      { Player } as unknown as YouTubeApi,
      element,
      { videoId: "_yPrykaB2nE", startSeconds: 1889.5, endSeconds: 1897 },
      {} as YouTubeEvents,
    );
    expect(Player).toHaveBeenCalledWith(
      element,
      expect.objectContaining({
        videoId: "_yPrykaB2nE",
        playerVars: expect.objectContaining({
          start: 1889,
          origin: window.location.origin,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
        }),
      }),
    );
  });
  it.each([
    [100, /no longer available/],
    [101, /disabled/],
    [150, /disabled/],
    [153, /identify/],
    [5, /couldn't play/],
  ])("describes provider error %i", async (code, message) => {
    const { describeYouTubeError } = await import("@/lib/video/youtube-api");
    expect(describeYouTubeError(Number(code))).toMatch(message as RegExp);
  });
});
