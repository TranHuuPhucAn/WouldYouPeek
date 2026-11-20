import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPlayback } from "@/components/challenge/ScenarioPlayback";
import { YouTubeScenarioPlayer } from "@/components/challenge/YouTubeScenarioPlayer";
import { UploadedScenarioPlayer } from "@/components/challenge/UploadedScenarioPlayer";
import { creatorPreview } from "./creator-fixtures";
import { challenges, answerFor } from "./fixtures";
import { VIDEO_ID } from "./video-fixtures";
vi.mock("@/components/challenge/YouTubeScenarioPlayer", () => ({
  YouTubeScenarioPlayer: vi.fn(() => <div data-testid="youtube-provider" />),
}));
vi.mock("@/components/challenge/UploadedScenarioPlayer", () => ({
  UploadedScenarioPlayer: vi.fn(() => <div data-testid="uploaded-provider" />),
}));
const common = () => ({
  analysisVisible: false,
  playbackKey: "scope:attempt",
  autoplay: true,
  onPlaybackEvent: vi.fn(),
  onComplete: vi.fn(),
  onReadAnalysis: vi.fn(),
});
describe("scenario media routing", () => {
  it("retains the provider through pause and masks first-continuation labels without changing saved data", () => {
    const p = creatorPreview(),
      c = p.challenge,
      answer = p.feedbackByOption[c.options[0].id],
      props = common();
    answer.reveal.caption = "Outcome spoiler";
    answer.reveal.alt = "Spoiler alternative text";
    const view = render(
      <ScenarioPlayback challenge={c} mode="setup" {...props} />,
    );
    const node = screen.getByTestId("youtube-provider");
    expect(
      vi.mocked(YouTubeScenarioPlayer).mock.calls.at(-1)![0].reveal,
    ).toBeUndefined();
    view.rerender(
      <ScenarioPlayback challenge={c} mode="decision" {...props} />,
    );
    expect(screen.getByTestId("youtube-provider")).toBe(node);
    view.rerender(
      <ScenarioPlayback
        challenge={c}
        answer={answer}
        mode="reveal"
        {...props}
      />,
    );
    const active = vi.mocked(YouTubeScenarioPlayer).mock.calls.at(-1)![0];
    expect(active.reveal).toMatchObject({
      alt: "Watch the continuation",
      caption: undefined,
    });
    expect(active.hideCaption).toBe(true);
    expect(active.onComplete).toBe(props.onComplete);
    expect(answer.reveal.alt).toBe("Spoiler alternative text");
    view.rerender(
      <ScenarioPlayback
        challenge={c}
        answer={answer}
        mode="reveal"
        {...props}
        analysisVisible
      />,
    );
    expect(
      vi.mocked(YouTubeScenarioPlayer).mock.calls.at(-1)![0].reveal,
    ).toEqual(answer.reveal);
    expect(screen.getByTestId("youtube-provider")).toBe(node);
  });
  it("requires a saved reveal and forwards the exact private playback context", () => {
    const c = {
        ...challenges[0],
        setup: {
          kind: "uploaded-video" as const,
          assetId: VIDEO_ID,
          startSeconds: 1,
          endSeconds: 5,
          alt: "Source",
        },
      },
      props = common();
    const context = {
      kind: "session-item" as const,
      sessionId: "saved-session",
      itemId: "original-item",
      phase: "setup" as const,
    };
    const view = render(
      <ScenarioPlayback
        challenge={c}
        mode="setup"
        context={context}
        {...props}
      />,
    );
    expect(
      vi.mocked(UploadedScenarioPlayer).mock.calls.at(-1)![0].context,
    ).toEqual(context);
    view.rerender(
      <ScenarioPlayback
        challenge={c}
        mode="reveal"
        context={context}
        {...props}
      />,
    );
    expect(screen.queryByTestId("uploaded-provider")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
  });
  it("uses deliberate acknowledgement for legacy illustrations instead of a fake playback completion", () => {
    const c = challenges[0],
      answer = answerFor(c.id),
      props = common();
    const view = render(
      <ScenarioPlayback challenge={c} mode="setup" {...props} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Continue to decision/ }),
    );
    expect(props.onComplete).toHaveBeenCalledOnce();
    view.rerender(
      <ScenarioPlayback
        challenge={c}
        answer={answer}
        mode="reveal"
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read analysis/ }));
    expect(props.onReadAnalysis).toHaveBeenCalledOnce();
    expect(props.onPlaybackEvent).not.toHaveBeenCalled();
  });
});
