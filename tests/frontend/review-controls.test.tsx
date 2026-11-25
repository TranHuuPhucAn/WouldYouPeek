import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReviewControls } from "@/components/challenge/ReviewControls";

const props = () => ({
  analysisVisible: false,
  status: "idle" as const,
  analysisId: "answer-analysis",
  reviewMedia: "outcome" as const,
  onShowAnalysis: vi.fn(),
  onViewAnalysis: vi.fn(),
  onShowSetup: vi.fn(),
  onShowOutcome: vi.fn(),
  onNext: vi.fn(),
});
describe("review actions", () => {
  it("keeps the silent-stall escape reachable without displaying next or duplicate transport controls", () => {
    const p = props();
    render(<ReviewControls {...p} />);
    expect(
      screen.queryByRole("button", { name: /Next scenario/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^(Play|Pause|Retry)/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Video trouble?"));
    fireEvent.click(
      screen.getByRole("button", { name: "Read saved analysis" }),
    );
    expect(p.onShowAnalysis).toHaveBeenCalledOnce();
    expect(p.onNext).not.toHaveBeenCalled();
  });
  it.each(["error", "blocked"] as const)(
    "offers direct saved analysis after %s",
    (status) => {
      const p = props();
      render(<ReviewControls {...p} status={status} />);
      expect(
        screen.getByRole("button", { name: "Read saved analysis" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /Next scenario/ }),
      ).not.toBeInTheDocument();
    },
  );
  it("permits review and replay while a next command is pending, without repeating that command", () => {
    const p = props();
    render(
      <ReviewControls
        {...p}
        analysisVisible
        status="complete"
        pending
        nextLabel="Finish session"
      />,
    );
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Watch setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Watch continuation" }));
    fireEvent.click(screen.getByRole("link", { name: "View analysis" }));
    expect(p.onShowSetup).toHaveBeenCalledOnce();
    expect(p.onShowOutcome).toHaveBeenCalledOnce();
    expect(p.onViewAnalysis).toHaveBeenCalledOnce();
    expect(p.onNext).not.toHaveBeenCalled();
  });
});
