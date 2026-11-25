import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPreview } from "@/components/creator/ScenarioPreview";
import { creatorPreview } from "./creator-fixtures";
vi.mock("@/components/challenge/YouTubeScenarioPlayer", () => ({
  YouTubeScenarioPlayer: ({
    mode,
    onComplete,
    playbackKey,
    onPlaybackEvent,
  }: ComponentProps<
    typeof import("@/components/challenge/YouTubeScenarioPlayer").YouTubeScenarioPlayer
  >) => (
    <div data-testid="preview-player" data-mode={mode}>
      <button onClick={onComplete}>Reach decision</button>
      <button
        onClick={() =>
          onPlaybackEvent?.({
            playbackKey: playbackKey!,
            mode,
            type: "complete",
          })
        }
      >
        Finish continuation
      </button>
    </div>
  ),
}));
describe("saved owner preview", () => {
  it("commits locally, waits for continuation before analysis, and makes no learner API call", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const p = creatorPreview();
    render(<ScenarioPreview preview={p} />);
    expect(
      screen.queryByText(
        p.feedbackByOption[p.challenge.options[0].id].takeaway,
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reach decision" }));
    fireEvent.click(
      screen.getByRole("radio", {
        name: new RegExp(p.challenge.options[1].label),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lock in/ }));
    expect(screen.getByTestId("preview-player")).toHaveAttribute(
      "data-mode",
      "reveal",
    );
    expect(
      screen.queryByRole("region", { name: "Answer feedback" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Finish continuation" }),
    );
    expect(
      screen.getByText(/Different choice from the pro/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Deeper reasoning & limitations"));
    expect(
      screen.getByRole("region", { name: "Creator analysis" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(p.feedbackByOption[p.challenge.options[1].id].takeaway),
    ).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("can try a different option without rewriting or finishing a learner session", () => {
    const p = creatorPreview();
    render(<ScenarioPreview preview={p} />);
    fireEvent.click(screen.getByRole("button", { name: "Reach decision" }));
    fireEvent.click(
      screen.getByRole("radio", {
        name: new RegExp(p.challenge.options[0].label),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lock in/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Finish continuation" }),
    );
    expect(screen.getByText(/Same choice as the pro/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try another choice/ }));
    expect(screen.getByTestId("preview-player")).toHaveAttribute(
      "data-mode",
      "setup",
    );
    expect(
      screen.queryByText(/Same choice as the pro/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reach decision" }));
    expect(
      screen
        .getAllByRole("radio")
        .every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
  });
});
