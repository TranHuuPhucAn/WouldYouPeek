import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPreview } from "@/components/creator/ScenarioPreview";
import { creatorPreview } from "./creator-fixtures";
vi.mock("@/components/challenge/YouTubeScenarioPlayer", () => ({
  YouTubeScenarioPlayer: ({
    mode,
    onComplete,
  }: {
    mode: string;
    onComplete: () => void;
  }) => (
    <div data-testid="preview-player" data-mode={mode}>
      <button onClick={onComplete}>Reach decision</button>
    </div>
  ),
}));
describe("saved owner preview", () => {
  it("commits locally, immediately shows analysis below continuation, and makes no learner API call", () => {
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
      screen.getByText("Different choice from the pro"),
    ).toBeInTheDocument();
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
    expect(screen.getByText("Same choice as the pro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try another choice/ }));
    expect(screen.getByTestId("preview-player")).toHaveAttribute(
      "data-mode",
      "setup",
    );
    expect(
      screen.queryByText("Same choice as the pro"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reach decision" }));
    expect(
      screen
        .getAllByRole("radio")
        .every((radio) => !(radio as HTMLInputElement).checked),
    ).toBe(true);
  });
});
