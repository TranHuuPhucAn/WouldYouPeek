import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadedScenarioPlayer } from "@/components/challenge/UploadedScenarioPlayer";
import { useUploadedPlayback } from "@/hooks/use-uploaded-playback";
import { VIDEO_ID } from "./video-fixtures";
vi.mock("@/hooks/use-uploaded-playback");
const setup = {
  kind: "uploaded-video" as const,
  assetId: VIDEO_ID,
  startSeconds: 10,
  endSeconds: 20,
  alt: "Player setup",
};
const reveal = {
  ...setup,
  startSeconds: 20,
  endSeconds: 30,
  alt: "Player continuation",
};
const context = {
  kind: "session-item" as const,
  sessionId: VIDEO_ID,
  itemId: VIDEO_ID,
  phase: "setup" as const,
};
const refresh = vi.fn(async () => {});
let access: ReturnType<typeof useUploadedPlayback>;
beforeEach(() => {
  vi.useFakeTimers();
  access = {
    access: {
      assetId: VIDEO_ID,
      url: "http://localhost/signed-a",
      expiresAt: "2026-12-01T12:00:00Z",
    },
    loading: false,
    error: null,
    invalid: false,
    refresh,
  };
  vi.mocked(useUploadedPlayback).mockImplementation(() => access);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    async function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", {
        configurable: true,
        value: false,
      });
      this.dispatchEvent(new Event("play"));
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());
function ready() {
  const element = screen.getByLabelText(
    /Player (setup|continuation)/,
  ) as HTMLVideoElement;
  Object.defineProperty(element, "readyState", {
    configurable: true,
    value: 4,
  });
  fireEvent.loadedMetadata(element);
  fireEvent.seeked(element);
  return element;
}

it.each(["setup", "reveal"] as const)(
  "pauses a manual %s and rejects late events until the learner explicitly plays again",
  async (mode) => {
    const events = vi.fn(),
      complete = vi.fn();
    const props = {
      setup,
      reveal,
      mode,
      context: { ...context, phase: mode },
      autoplay: false,
      onPlaybackEvent: events,
      onComplete: complete,
    };
    const view = render(<UploadedScenarioPlayer {...props} />);
    const video = ready();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => {});
    const time = mode === "setup" ? 14 : 24;
    video.currentTime = time;
    events.mockClear();
    view.rerender(<UploadedScenarioPlayer {...props} suspended />);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(time);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
    });
    fireEvent.play(video);
    expect(video.paused).toBe(true);
    video.currentTime = mode === "setup" ? 20 : 30;
    fireEvent.ended(video);
    act(() => vi.advanceTimersByTime(100));
    expect(events).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    view.rerender(<UploadedScenarioPlayer {...props} />);
    fireEvent.ended(video);
    act(() => vi.advanceTimersByTime(100));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(events).not.toHaveBeenCalled();
    video.currentTime = time;
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => {});
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(video.paused).toBe(false);
  },
);

it("keeps a renewed capability paused across suspension and closing", async () => {
  const props = {
    setup,
    reveal,
    mode: "reveal" as const,
    context: { ...context, phase: "reveal" as const },
    autoplay: true,
  };
  const view = render(<UploadedScenarioPlayer {...props} />);
  const video = ready();
  await act(async () => {});
  video.currentTime = 24;
  view.rerender(<UploadedScenarioPlayer {...props} suspended />);
  const beforeReplace = vi.mocked(useUploadedPlayback).mock.calls.at(-1)![2]!;
  act(() => beforeReplace());
  access = {
    ...access,
    access: { ...access.access!, url: "http://localhost/signed-suspended" },
  };
  view.rerender(<UploadedScenarioPlayer {...props} suspended />);
  video.currentTime = 0;
  fireEvent.loadedMetadata(video);
  fireEvent.seeked(video);
  expect(video.currentTime).toBe(24);
  expect(video.paused).toBe(true);
  view.rerender(<UploadedScenarioPlayer {...props} />);
  expect(video.paused).toBe(true);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {});
  expect(video.currentTime).toBe(24);
  expect(video.paused).toBe(false);
});

it("does not autoplay an uploaded continuation first mounted under a dialog", () => {
  const props = {
    setup,
    reveal,
    mode: "reveal" as const,
    context: { ...context, phase: "reveal" as const },
    autoplay: true,
  };
  const view = render(<UploadedScenarioPlayer {...props} suspended />);
  const video = ready();
  expect(video.paused).toBe(true);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  view.rerender(<UploadedScenarioPlayer {...props} />);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
describe("bounded native recording playback", () => {
  it("positions at setup start, pauses before decision and keeps the same element for reveal", async () => {
    const complete = vi.fn();
    const view = render(
      <UploadedScenarioPlayer
        setup={setup}
        mode="setup"
        context={context}
        onComplete={complete}
      />,
    );
    const video = ready();
    expect(video.currentTime).toBe(10);
    expect(video.controls).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    video.currentTime = 19.8;
    act(() => vi.advanceTimersByTime(50));
    fireEvent.seeked(video);
    expect(complete).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(19.7);
    expect(video.paused).toBe(true);
    view.rerender(
      <UploadedScenarioPlayer
        setup={setup}
        mode="decision"
        context={context}
        onComplete={complete}
      />,
    );
    expect(screen.getByLabelText("Player setup")).toBe(video);
    expect(
      screen.getByRole("button", { name: "Replay segment" }),
    ).toBeDisabled();
    view.rerender(
      <UploadedScenarioPlayer
        setup={setup}
        reveal={reveal}
        mode="reveal"
        context={{ ...context, phase: "reveal" }}
        onComplete={complete}
      />,
    );
    fireEvent.seeked(video);
    expect(screen.getByLabelText("Player continuation")).toBe(video);
    expect(video.currentTime).toBe(20);
    video.currentTime = 29.9;
    fireEvent.timeUpdate(video);
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(29.7);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("restores a paused decision after URL renewal without replay or completion mutation", () => {
    const complete = vi.fn();
    const view = render(
      <UploadedScenarioPlayer
        setup={setup}
        mode="decision"
        context={context}
        onComplete={complete}
      />,
    );
    const video = ready();
    expect(video.currentTime).toBe(19.7);
    const beforeReplace = vi.mocked(useUploadedPlayback).mock.calls.at(-1)![2]!;
    act(() => beforeReplace());
    access = {
      ...access,
      access: { ...access.access!, url: "http://localhost/signed-b" },
    };
    view.rerender(
      <UploadedScenarioPlayer
        setup={setup}
        mode="decision"
        context={context}
        onComplete={complete}
      />,
    );
    video.currentTime = 0;
    fireEvent.loadedMetadata(video);
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(19.7);
    expect(video.paused).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(video).toHaveAttribute("src", "http://localhost/signed-b");
  });
  it("hides and clamps seeks outside the active segment and removes media after auth invalidation", () => {
    const view = render(
      <UploadedScenarioPlayer setup={setup} mode="setup" context={context} />,
    );
    const video = ready();
    video.currentTime = 50;
    fireEvent.seeking(video);
    expect(video.style.visibility).toBe("hidden");
    fireEvent.seeked(video);
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(19.7);
    access = { ...access, invalid: true, access: null, error: "Sign in again" };
    view.rerender(
      <UploadedScenarioPlayer setup={setup} mode="setup" context={context} />,
    );
    expect(screen.queryByLabelText("Player setup")).not.toBeInTheDocument();
    expect(video.paused).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in again");
  });
  it("does not mount a capability for a different asset", () => {
    access = {
      ...access,
      access: {
        ...access.access!,
        assetId: "82300000-0000-4000-8000-000000000099",
      },
    };
    render(
      <UploadedScenarioPlayer setup={setup} mode="setup" context={context} />,
    );
    expect(screen.queryByLabelText("Player setup")).not.toBeInTheDocument();
  });
});

it("emits active-range events only after positioning and preserves them across metadata renders", async () => {
  const events = vi.fn();
  const view = render(
    <UploadedScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="reveal"
      context={{ ...context, phase: "reveal" }}
      playbackKey="answer:reveal"
      onPlaybackEvent={events}
      autoplay
    />,
  );
  const video = screen.getByLabelText(
    "Player continuation",
  ) as HTMLVideoElement;
  video.currentTime = 30;
  fireEvent.ended(video);
  expect(events).not.toHaveBeenCalled();
  ready();
  await act(async () => {});
  expect(events).toHaveBeenCalledWith({
    playbackKey: "answer:reveal",
    mode: "reveal",
    type: "started",
  });
  video.currentTime = 22;
  view.rerender(
    <UploadedScenarioPlayer
      setup={setup}
      reveal={{ ...reveal, caption: "Visible analysis" }}
      mode="reveal"
      context={{ ...context, phase: "reveal" }}
      playbackKey="answer:reveal"
      onPlaybackEvent={events}
      autoplay
    />,
  );
  expect(video.currentTime).toBe(22);
  fireEvent.ended(video);
  expect(events.mock.calls.filter(([e]) => e.type === "complete")).toHaveLength(
    0,
  );
  video.currentTime = 29.8;
  fireEvent.timeUpdate(video);
  fireEvent.seeked(video);
  fireEvent.ended(video);
  expect(events.mock.calls.filter(([e]) => e.type === "complete")).toHaveLength(
    1,
  );
});
it("cues reopened review, allows manual play, and rejects a stale play rejection after a new mode", async () => {
  let reject!: (reason: Error) => void;
  const events = vi.fn();
  const view = render(
    <UploadedScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="reveal"
      context={{ ...context, phase: "reveal" }}
      playbackKey="saved:reveal"
      onPlaybackEvent={events}
      autoplay={false}
    />,
  );
  const video = ready();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
    () =>
      new Promise((_resolve, failure) => {
        reject = failure;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  view.rerender(
    <UploadedScenarioPlayer
      setup={setup}
      reveal={reveal}
      mode="review-setup"
      context={context}
      playbackKey="saved:setup"
      onPlaybackEvent={events}
      autoplay={false}
    />,
  );
  fireEvent.seeked(video);
  await act(async () => reject(new Error("old blocked request")));
  expect(events.mock.calls.filter(([e]) => e.type === "blocked")).toHaveLength(
    0,
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {});
  expect(events).toHaveBeenCalledWith({
    playbackKey: "saved:setup",
    mode: "review-setup",
    type: "started",
  });
});
it("preserves safe position during URL renewal and emits started again after a recovered source", async () => {
  const events = vi.fn();
  const props = {
    setup,
    reveal,
    mode: "reveal" as const,
    context: { ...context, phase: "reveal" as const },
    playbackKey: "saved",
    onPlaybackEvent: events,
    autoplay: true,
  };
  const view = render(<UploadedScenarioPlayer {...props} />);
  const video = ready();
  await act(async () => {});
  video.currentTime = 24;
  const beforeReplace = vi.mocked(useUploadedPlayback).mock.calls.at(-1)![2]!;
  act(() => beforeReplace());
  access = {
    ...access,
    access: { ...access.access!, url: "http://localhost/signed-new" },
  };
  view.rerender(<UploadedScenarioPlayer {...props} />);
  video.currentTime = 0;
  fireEvent.loadedMetadata(video);
  fireEvent.seeked(video);
  await act(async () => {});
  expect(video.currentTime).toBe(24);
  expect(events.mock.calls.filter(([e]) => e.type === "started")).toHaveLength(
    2,
  );
  expect(events.mock.calls.filter(([e]) => e.type === "complete")).toHaveLength(
    0,
  );
});
it("reports a current blocked play and pauses the continuation when saved analysis is explicitly read", async () => {
  const events = vi.fn();
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
    new Error("Autoplay blocked"),
  );
  const props = {
    setup,
    reveal,
    mode: "reveal" as const,
    context: { ...context, phase: "reveal" as const },
    playbackKey: "active",
    onPlaybackEvent: events,
  };
  const view = render(<UploadedScenarioPlayer {...props} autoplay />);
  const video = ready();
  await act(async () => {});
  expect(events).toHaveBeenCalledWith({
    playbackKey: "active",
    mode: "reveal",
    type: "blocked",
  });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {});
  expect(video.paused).toBe(false);
  view.rerender(<UploadedScenarioPlayer {...props} autoplay={false} />);
  expect(video.paused).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await act(async () => {});
  expect(video.paused).toBe(false);
});
