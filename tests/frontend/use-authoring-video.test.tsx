import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthoringVideo } from "@/hooks/use-authoring-video";
import { useUploadedPlayback } from "@/hooks/use-uploaded-playback";
import { createUploadedSource } from "@/lib/creator/content";
import { VIDEO_ID } from "./video-fixtures";
vi.mock("@/hooks/use-uploaded-playback");
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(useUploadedPlayback).mockReturnValue({
    access: {
      assetId: VIDEO_ID,
      url: "http://localhost/source-a",
      expiresAt: "2026-12-01T12:00:00Z",
    },
    loading: false,
    error: null,
    invalid: false,
    refresh: vi.fn(async () => {}),
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => vi.useRealTimers());
describe("full recording authoring adapter", () => {
  it("enables marks only after real duration, reads live time and clamps explicit seeks", () => {
    const { result } = renderHook(() =>
      useAuthoringVideo(createUploadedSource(VIDEO_ID)),
    );
    const video = document.createElement("video");
    result.current.nativeRef.current = video;
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 120,
    });
    expect(result.current.ready).toBe(false);
    act(() => result.current.nativeHandlers.onLoadedMetadata());
    expect(result.current.ready).toBe(true);
    expect(result.current.duration).toBe(120);
    video.currentTime = 24.912;
    expect(result.current.readTime()).toBe(24.912);
    act(() => result.current.seek(999));
    expect(video.currentTime).toBe(120);
    expect(result.current.seeking).toBe(true);
    act(() => result.current.nativeHandlers.onSeeked());
    expect(result.current.time).toBe(120);
    expect(result.current.seeking).toBe(false);
    act(() => result.current.seek(-10));
    expect(video.currentTime).toBe(0);
  });
  it("restores position after capability renewal without changing authored marks", () => {
    const { result } = renderHook(() =>
      useAuthoringVideo(createUploadedSource(VIDEO_ID)),
    );
    const video = document.createElement("video");
    result.current.nativeRef.current = video;
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 120,
    });
    act(() => result.current.nativeHandlers.onLoadedMetadata());
    video.currentTime = 55.5;
    act(() => vi.mocked(useUploadedPlayback).mock.calls.at(-1)![2]!());
    expect(result.current.ready).toBe(false);
    expect(video.style.visibility).toBe("hidden");
    video.currentTime = 0;
    act(() => result.current.nativeHandlers.onLoadedMetadata());
    expect(video.currentTime).toBe(55.5);
    act(() => result.current.nativeHandlers.onSeeked());
    expect(result.current.ready).toBe(true);
    expect(result.current.time).toBe(55.5);
  });
  it("rejects unusable metadata and stops editing after identity invalidation", () => {
    const { result } = renderHook(() =>
      useAuthoringVideo(createUploadedSource(VIDEO_ID)),
    );
    const video = document.createElement("video");
    result.current.nativeRef.current = video;
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: Infinity,
    });
    act(() => result.current.nativeHandlers.onLoadedMetadata());
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toContain("duration");
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toContain("session changed");
  });
});

it("keeps native manual seeks paused if the element emits an unsolicited play event", () => {
  const { result } = renderHook(() =>
    useAuthoringVideo(createUploadedSource(VIDEO_ID)),
  );
  const video = document.createElement("video");
  result.current.nativeRef.current = video;
  Object.defineProperty(video, "duration", { configurable: true, value: 120 });
  act(() => result.current.nativeHandlers.onLoadedMetadata());
  act(() => {
    result.current.pause();
    result.current.seek(20);
  });
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  act(() => result.current.nativeHandlers.onPlay());
  expect(video.paused).toBe(true);
  act(() => result.current.nativeHandlers.onSeeked());
  expect(result.current.time).toBe(20);
  expect(result.current.playing).toBe(false);
});
