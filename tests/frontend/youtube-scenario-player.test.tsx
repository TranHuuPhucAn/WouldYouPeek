import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeScenarioPlayer } from "@/components/challenge/YouTubeScenarioPlayer";
import type { YouTubeSegment } from "@/contracts/challenge";
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
  state: number;
  frame: HTMLIFrameElement;
};
const provider = vi.hoisted(() => ({ instances: [] as Instance[] }));

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
        state: 5,
        frame,
      };
      function state(data: number) {
        instance.state = data;
        events.onStateChange({ target: instance.player, data });
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
        }),
        getCurrentTime: () => instance.time,
        getPlayerState: () => instance.state,
        getIframe: () => frame,
        destroy: vi.fn(() => frame.remove()),
      };
      provider.instances.push(instance);
      return instance.player;
    },
  ),
}));

const setup: YouTubeSegment = {
  kind: "youtube",
  videoId: "_yPrykaB2nE",
  startSeconds: 1705,
  endSeconds: 1713,
  alt: "TenZ player POV",
};
const reveal: YouTubeSegment = {
  ...setup,
  startSeconds: 1713,
  endSeconds: 1718,
};

async function ready(index = provider.instances.length - 1) {
  await act(async () => {});
  const instance =
    provider.instances[index < 0 ? provider.instances.length - 1 : index];
  await act(async () => {
    instance.events.onReady({ target: instance.player });
  });
  return instance;
}
function state(instance: Instance, data: number, time = instance.time) {
  act(() => {
    instance.time = time;
    instance.state = data;
    instance.events.onStateChange({ target: instance.player, data });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  provider.instances.length = 0;
  vi.mocked(createYouTubePlayer).mockClear();
  vi.mocked(loadYouTubeApi).mockClear();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("persistent YouTube scenario playback", () => {
  it("pauses before the setup boundary exactly once and keeps the iframe through the decision", async () => {
    const complete = vi.fn();
    const view = render(
      <YouTubeScenarioPlayer
        setup={setup}
        mode="setup"
        onComplete={complete}
      />,
    );
    const instance = await ready();
    expect(instance.player.cueVideoById).toHaveBeenCalledWith({
      videoId: setup.videoId,
      startSeconds: 1705,
      endSeconds: 1713,
    });
    expect(instance.player.loadVideoById).not.toHaveBeenCalled();
    expect(instance.frame).toHaveAttribute("title", setup.alt);
    fireEvent.click(screen.getByRole("button", { name: "Play setup" }));
    state(instance, 1, 1712.68);
    expect(complete).not.toHaveBeenCalled();
    act(() => {
      instance.time = 1712.73;
      vi.advanceTimersByTime(75);
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(instance.player.pauseVideo).toHaveBeenCalled();
    view.rerender(
      <YouTubeScenarioPlayer
        setup={setup}
        mode="decision"
        onComplete={complete}
      />,
    );
    state(instance, 1, 1713.1);
    expect(instance.player.seekTo).toHaveBeenCalledWith(1712.7, true);
    expect(complete).toHaveBeenCalledOnce();
    expect(
      screen
        .getByRole("region", { name: "Decision paused" })
        .querySelector("iframe"),
    ).toBe(instance.frame);
    expect(createYouTubePlayer).toHaveBeenCalledOnce();
    expect(instance.player.destroy).not.toHaveBeenCalled();
  });

  it("loads the continuation only after reveal and ignores a delayed setup ENDED event", async () => {
    const complete = vi.fn();
    const view = render(
      <YouTubeScenarioPlayer
        setup={setup}
        mode="setup"
        onComplete={complete}
      />,
    );
    const instance = await ready();
    state(instance, 1, 1712.75);
    view.rerender(
      <YouTubeScenarioPlayer
        setup={setup}
        mode="decision"
        onComplete={complete}
      />,
    );
    expect(instance.player.loadVideoById).not.toHaveBeenCalled();
    view.rerender(
      <YouTubeScenarioPlayer
        setup={setup}
        reveal={reveal}
        mode="reveal"
        onComplete={complete}
      />,
    );
    expect(instance.player.loadVideoById).toHaveBeenLastCalledWith({
      videoId: setup.videoId,
      startSeconds: 1713,
      endSeconds: 1718,
    });
    state(instance, 1, 1713.1);
    state(instance, 0, 1713.15);
    expect(
      screen.queryByRole("button", { name: "Replay continuation" }),
    ).not.toBeInTheDocument();
    state(instance, 1, 1717.75);
    expect(
      screen.getByRole("button", { name: "Replay continuation" }),
    ).toBeVisible();
    expect(complete).toHaveBeenCalledOnce();
    expect(createYouTubePlayer).toHaveBeenCalledOnce();
  });

  it("fetches and pauses a safe source frame on decision retry instead of only cueing a thumbnail", async () => {
    const complete = vi.fn();
    render(
      <YouTubeScenarioPlayer
        setup={setup}
        mode="decision"
        onComplete={complete}
      />,
    );
    const first = await ready();
    state(first, 1, 1712.05);
    act(() => {
      first.events.onError({ target: first.player, data: 100 });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
    fireEvent.click(screen.getByRole("button", { name: "Retry video" }));
    const second = await ready(1);
    expect(first.player.destroy).toHaveBeenCalledOnce();
    expect(second.player.loadVideoById).toHaveBeenCalledWith({
      videoId: setup.videoId,
      startSeconds: 1712,
      endSeconds: 1713,
    });
    expect(second.player.cueVideoById).not.toHaveBeenCalled();
    state(second, 1, 1712.05);
    expect(second.state).toBe(2);
    expect(complete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["pause", "autoplay", "ended"] as const)(
    "clears the buffering watchdog after %s",
    async (event) => {
      render(
        <YouTubeScenarioPlayer setup={setup} reveal={reveal} mode="reveal" />,
      );
      const instance = await ready();
      state(instance, 3);
      if (event === "autoplay")
        act(() => {
          instance.events.onAutoplayBlocked({ target: instance.player });
        });
      else
        state(
          instance,
          event === "ended" ? 0 : 2,
          event === "ended" ? 1718 : 1713.1,
        );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(21000);
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /continuation/i }),
      ).toBeEnabled();
    },
  );

  it("pauses when hidden and also catches PLAYING that arrives after the tab was hidden", async () => {
    render(<YouTubeScenarioPlayer setup={setup} mode="setup" />);
    const instance = await ready();
    state(instance, 1, 1706);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(instance.state).toBe(2);
    state(instance, 3);
    state(instance, 1, 1706.2);
    expect(instance.state).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports sustained buffering and cleans up late callbacks and timers on unmount", async () => {
    const complete = vi.fn();
    const view = render(
      <YouTubeScenarioPlayer
        setup={setup}
        mode="setup"
        onComplete={complete}
      />,
    );
    const instance = await ready();
    state(instance, 3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("taking too long");
    view.unmount();
    expect(instance.player.destroy).toHaveBeenCalledOnce();
    state(instance, 1, 1713);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(complete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from an API loader rejection", async () => {
    vi.mocked(loadYouTubeApi).mockRejectedValueOnce(
      new Error("Source connection failed"),
    );
    render(<YouTubeScenarioPlayer setup={setup} mode="setup" />);
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Source connection failed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry video" }));
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play setup" })).toBeEnabled();
  });
});

it("emits scoped continuation events once and does not restart when feedback metadata changes", async () => {
  const events = vi.fn();
  const view = render(
    <YouTubeScenarioPlayer
      setup={setup}
      reveal={{ ...reveal, caption: undefined, alt: "Neutral" }}
      mode="reveal"
      playbackKey="answer:reveal:1"
      onPlaybackEvent={events}
      autoplay
      hideCaption
    />,
  );
  const instance = await ready();
  state(instance, 1, 1714);
  expect(events).toHaveBeenCalledWith({
    playbackKey: "answer:reveal:1",
    mode: "reveal",
    type: "started",
  });
  view.rerender(
    <YouTubeScenarioPlayer
      setup={setup}
      reveal={{ ...reveal, caption: "Analysis now available" }}
      mode="reveal"
      playbackKey="answer:reveal:1"
      onPlaybackEvent={events}
      autoplay
    />,
  );
  expect(instance.player.loadVideoById).toHaveBeenCalledOnce();
  state(instance, 0, 1713.1);
  expect(events.mock.calls.filter(([e]) => e.type === "complete")).toHaveLength(
    0,
  );
  state(instance, 1, 1717.8);
  state(instance, 0, 1718);
  expect(events.mock.calls.filter(([e]) => e.type === "complete")).toEqual([
    [{ playbackKey: "answer:reveal:1", mode: "reveal", type: "complete" }],
  ]);
});
it("keeps reopened review quiet, permits manual play and pauses an explicit analysis escape", async () => {
  const events = vi.fn();
  const view = render(
    <YouTubeScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="reveal"
      playbackKey="saved"
      onPlaybackEvent={events}
      autoplay={false}
    />,
  );
  const instance = await ready();
  expect(instance.player.loadVideoById).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Play continuation" }));
  expect(instance.player.playVideo).toHaveBeenCalledOnce();
  view.rerender(
    <YouTubeScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="reveal"
      playbackKey="replay"
      onPlaybackEvent={events}
      autoplay
    />,
  );
  view.rerender(
    <YouTubeScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="reveal"
      playbackKey="replay"
      onPlaybackEvent={events}
      autoplay={false}
    />,
  );
  expect(instance.state).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Play continuation" }));
  expect(instance.player.playVideo).toHaveBeenCalledTimes(2);
});
it("rejects callbacks from a replaced provider and preserves manual volume on retry", async () => {
  const events = vi.fn();
  render(
    <YouTubeScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="reveal"
      playbackKey="active"
      onPlaybackEvent={events}
      autoplay
    />,
  );
  const first = await ready();
  first.player.setVolume = vi.fn();
  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
    target: { value: "35" },
  });
  expect(first.player.setVolume).toHaveBeenCalledWith(35);
  act(() => first.events.onAutoplayBlocked({ target: first.player }));
  expect(events).toHaveBeenLastCalledWith({
    playbackKey: "active",
    mode: "reveal",
    type: "blocked",
  });
  act(() => first.events.onError({ target: first.player, data: 100 }));
  fireEvent.click(screen.getByRole("button", { name: "Retry video" }));
  await act(async () => {});
  const second = provider.instances[1];
  second.player.setVolume = vi.fn();
  await ready(1);
  events.mockClear();
  expect(second.player.setVolume).toHaveBeenCalledWith(35);
  state(first, 1, 1717.9);
  act(() => first.events.onAutoplayBlocked({ target: first.player }));
  expect(events).not.toHaveBeenCalled();
  state(second, 1, 1714);
  expect(events).toHaveBeenCalledWith({
    playbackKey: "active",
    mode: "reveal",
    type: "started",
  });
});
