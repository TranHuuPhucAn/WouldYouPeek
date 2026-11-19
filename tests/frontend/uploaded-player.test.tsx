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
