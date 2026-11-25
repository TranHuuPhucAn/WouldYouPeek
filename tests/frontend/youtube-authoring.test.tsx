import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoTimingEditor } from "@/components/creator/VideoTimingEditor";
import { useUploadedPlayback } from "@/hooks/use-uploaded-playback";
import { createEmptyDraft } from "@/lib/creator/content";
import {
  createYouTubePlayer,
  loadYouTubeApi,
  type VideoBounds,
  type YouTubeEvents,
  type YouTubePlayer,
} from "@/lib/video/youtube-api";

type Instance = {
  player: YouTubePlayer;
  events: YouTubeEvents;
  time: number;
  duration: number;
  state: number;
  frame: HTMLIFrameElement;
};
const provider = vi.hoisted(() => ({
  instances: [] as Instance[],
  playOnSeek: false,
}));
// The same controllable IFrame provider used by the existing scenario-player tests,
// extended with duration and volume for the full-source authoring controls.
vi.mock("@/lib/video/youtube-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video/youtube-api")>()),
  loadYouTubeApi: vi.fn(async () => ({})),
  createYouTubePlayer: vi.fn(
    (_api, mount: HTMLElement, bounds: VideoBounds, events: YouTubeEvents) => {
      const frame = document.createElement("iframe");
      mount.replaceWith(frame);
      const instance: Instance = {
        player: {} as YouTubePlayer,
        events,
        time: bounds.startSeconds,
        duration: 0,
        state: 5,
        frame,
      };
      function state(next: number) {
        instance.state = next;
        events.onStateChange({ target: instance.player, data: next });
      }
      instance.player = {
        cueVideoById: vi.fn((next: VideoBounds) => {
          instance.time = next.startSeconds;
          state(5);
        }),
        loadVideoById: vi.fn((next: VideoBounds) => {
          instance.time = next.startSeconds;
          state(3);
        }),
        playVideo: vi.fn(() => state(1)),
        pauseVideo: vi.fn(() => state(2)),
        seekTo: vi.fn((time) => {
          instance.time = time;
          if (provider.playOnSeek) state(1);
        }),
        getCurrentTime: () => instance.time,
        getDuration: () => instance.duration,
        getPlayerState: () => instance.state,
        getIframe: () => frame,
        setVolume: vi.fn(),
        destroy: vi.fn(() => frame.remove()),
      };
      provider.instances.push(instance);
      return instance.player;
    },
  ),
}));
vi.mock("@/hooks/use-uploaded-playback");
const firstUrl = "https://www.youtube.com/watch?v=_yPrykaB2nE";
const secondUrl = "https://www.youtube.com/watch?v=abcdefghijk";
function Authoring({ url = firstUrl }: { url?: string }) {
  const [media, setMedia] = useState(createEmptyDraft().media);
  return (
    <VideoTimingEditor
      source={{ ...createEmptyDraft().source, kind: undefined, url }}
      media={media}
      issues={[]}
      onChange={setMedia}
      onInputIssues={vi.fn()}
    />
  );
}
async function ready(duration = 120, index = provider.instances.length - 1) {
  await act(async () => {});
  const instance =
    provider.instances[index < 0 ? provider.instances.length - 1 : index];
  await act(async () => {
    instance.duration = duration;
    instance.events.onReady({ target: instance.player });
  });
  return instance;
}
function state(instance: Instance, value: number, time = instance.time) {
  act(() => {
    instance.state = value;
    instance.time = time;
    instance.events.onStateChange({ target: instance.player, data: value });
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  provider.instances.length = 0;
  provider.playOnSeek = false;
  vi.mocked(createYouTubePlayer).mockClear();
  vi.mocked(loadYouTubeApi)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(useUploadedPlayback).mockReturnValue({
    access: null,
    loading: false,
    error: null,
    invalid: false,
    refresh: vi.fn(async () => {}),
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => vi.useRealTimers());

describe("YouTube full-source authoring", () => {
  it("waits for actual duration before marking and captures live provider time", async () => {
    render(<Authoring />);
    const instance = await ready(0);
    expect(
      screen.getByRole("button", { name: "Set setup start" }),
    ).toBeDisabled();
    expect(instance.player.cueVideoById).toHaveBeenCalledWith({
      videoId: "_yPrykaB2nE",
      startSeconds: 0,
      endSeconds: 43200,
    });
    act(() => {
      instance.duration = 120;
      vi.advanceTimersByTime(200);
    });
    expect(
      screen.getByRole("button", { name: "Set setup start" }),
    ).toBeEnabled();
    // Deliberately move ahead of the polling display; marks must read the live player.
    instance.time = 12.345;
    fireEvent.click(screen.getByRole("button", { name: "Set setup start" }));
    expect(screen.getByLabelText("Setup starts")).toHaveValue("0:12.345");
    expect(instance.player.pauseVideo).toHaveBeenCalled();
    expect(instance.frame).toHaveAttribute(
      "title",
      "Source recording for manual timing",
    );
    expect(instance.player.loadVideoById).not.toHaveBeenCalled();
  });
  it("waits for seeks to settle, clamps step controls, and keeps typed marks synchronized", async () => {
    render(<Authoring />);
    const instance = await ready();
    fireEvent.change(screen.getByLabelText("Seek recording"), {
      target: { value: "25" },
    });
    expect(instance.player.seekTo).toHaveBeenLastCalledWith(25, true);
    state(instance, 3, 25);
    expect(
      screen.getByRole("button", { name: "Set decision pause" }),
    ).toBeDisabled();
    state(instance, 2, 25);
    expect(
      screen.getByRole("button", { name: "Set decision pause" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Set decision pause" }));
    expect(screen.getByLabelText("Decision pause")).toHaveValue("0:25");
    fireEvent.change(screen.getByLabelText("Decision pause"), {
      target: { value: "0:35.125" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Jump to decision pause" }),
    );
    expect(instance.player.seekTo).toHaveBeenLastCalledWith(35.125, true);
    state(instance, 2, 120);
    act(() => vi.advanceTimersByTime(200));
    // End the pending seek first, then verify forward stepping cannot exceed duration.
    state(instance, 2, 35.125);
    state(instance, 2, 120);
    fireEvent.click(screen.getByRole("button", { name: "Forward 1s" }));
    expect(instance.player.seekTo).toHaveBeenLastCalledWith(120, true);
    fireEvent.change(screen.getByLabelText("Recording volume"), {
      target: { value: "0.5" },
    });
    expect(instance.player.setVolume).toHaveBeenLastCalledWith(50);
  });
  it("keeps the provider for equivalent links and disposes obsolete sources and callbacks", async () => {
    const view = render(<Authoring />);
    const first = await ready();
    state(first, 2, 18);
    view.rerender(<Authoring url="https://youtu.be/_yPrykaB2nE?t=10" />);
    expect(createYouTubePlayer).toHaveBeenCalledOnce();
    expect(first.player.destroy).not.toHaveBeenCalled();
    view.rerender(<Authoring url={secondUrl} />);
    const second = await ready(60, 1);
    expect(first.player.destroy).toHaveBeenCalledOnce();
    expect(second.player.cueVideoById).toHaveBeenCalledWith({
      videoId: "abcdefghijk",
      startSeconds: 0,
      endSeconds: 43200,
    });
    state(first, 1, 88);
    act(() => first.events.onError({ target: first.player, data: 100 }));
    expect(screen.getByLabelText("Recording position")).toHaveTextContent(
      "0:00 / 1:00",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();
    expect(second.player.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses when hidden and invalidates editing after the account changes", async () => {
    render(<Authoring />);
    const instance = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(instance.player.playVideo).toHaveBeenCalledOnce();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(instance.player.pauseVideo).toHaveBeenCalled();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(instance.player.playVideo).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(screen.getByRole("alert")).toHaveTextContent("session changed");
    expect(
      screen.getByRole("button", { name: "Set setup start" }),
    ).toBeDisabled();
  });
  it("recovers provider errors by replacing the failed iframe and cancels pending initialization on unmount", async () => {
    const view = render(<Authoring />);
    const first = await ready();
    act(() => first.events.onError({ target: first.player, data: 100 }));
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry source player" }),
    );
    const second = await ready(120, 1);
    expect(first.player.destroy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();
    expect(second.player.destroy).toHaveBeenCalledOnce();
    let resolve!: (value: never) => void;
    vi.mocked(loadYouTubeApi).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = render(<Authoring />);
    pending.unmount();
    await act(async () => resolve({} as never));
    expect(createYouTubePlayer).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("keeps a manual jump paused when YouTube automatically plays after seekTo", async () => {
  provider.playOnSeek = true;
  render(<Authoring />);
  const instance = await ready(1800);
  fireEvent.change(screen.getByLabelText("Setup starts"), {
    target: { value: "28:25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Jump to setup start" }));
  expect(instance.player.seekTo).toHaveBeenLastCalledWith(1705, true);
  expect(instance.state).toBe(2);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole("button", { name: "Play recording" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Set setup start" }));
  expect(screen.getByLabelText("Setup starts")).toHaveValue("28:25");
  fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
  expect(instance.state).toBe(1);
  expect(screen.getByRole("button", { name: "Pause recording" })).toBeEnabled();
});
