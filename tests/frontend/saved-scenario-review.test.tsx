import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SessionRecap } from "@/components/challenge/SessionRecap";
import { ScenarioPlayback } from "@/components/challenge/ScenarioPlayback";
import { snapshot, viewer } from "./session-fixtures";
const destroy = vi.fn();
vi.mock("@/components/challenge/ScenarioPlayback", () => ({
  ScenarioPlayback: vi.fn(() => {
    useEffect(() => destroy, []);
    return <div data-testid="saved-player">Saved video</div>;
  }),
}));
describe("completed session replay", () => {
  it.each(["Watch setup", "Watch continuation"])(
    "returns keyboard focus to %s when its replay closes",
    async (label) => {
      const user = userEvent.setup();
      const saved = snapshot("completed");
      render(
        <SessionRecap
          items={saved.items}
          sessionId={saved.id}
          viewerId={viewer.id}
          onRestart={vi.fn()}
        />,
      );
      const card =
        document.querySelector<HTMLDetailsElement>("details.recap-card")!;
      await user.click(within(card).getByText(saved.items[0].challenge.title));
      const trigger = within(card).getByRole("button", { name: label });
      await user.click(trigger);
      const close = within(card).getByRole("button", { name: "Close video" });
      close.focus();
      await user.keyboard("{Enter}");
      expect(screen.queryByTestId("saved-player")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    },
  );
  it("mounts no media until requested, uses saved item identity, and keeps only one player", () => {
    const saved = snapshot("completed"),
      immutable = structuredClone(saved),
      restart = vi.fn(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <SessionRecap
        items={saved.items}
        sessionId={saved.id}
        viewerId={viewer.id}
        onRestart={restart}
      />,
    );
    expect(screen.queryByTestId("saved-player")).not.toBeInTheDocument();
    expect(ScenarioPlayback).not.toHaveBeenCalled();
    const cards = Array.from(
      document.querySelectorAll<HTMLDetailsElement>("details.recap-card"),
    );
    fireEvent.click(within(cards[0]).getByText(saved.items[0].challenge.title));
    fireEvent.click(
      within(cards[0]).getByRole("button", { name: "Watch continuation" }),
    );
    expect(screen.getAllByTestId("saved-player")).toHaveLength(1);
    expect(vi.mocked(ScenarioPlayback).mock.calls.at(-1)![0]).toMatchObject({
      challenge: saved.items[0].challenge,
      answer: saved.items[0].answer!.result,
      autoplay: true,
      analysisVisible: true,
      context: {
        kind: "session-item",
        sessionId: saved.id,
        itemId: saved.items[0].id,
        phase: "reveal",
      },
    });
    fireEvent.click(within(cards[1]).getByText(saved.items[1].challenge.title));
    fireEvent.click(
      within(cards[1]).getByRole("button", { name: "Watch setup" }),
    );
    expect(screen.getAllByTestId("saved-player")).toHaveLength(1);
    expect(destroy).toHaveBeenCalledOnce();
    expect(
      vi.mocked(ScenarioPlayback).mock.calls.at(-1)![0].context,
    ).toMatchObject({ itemId: saved.items[1].id, phase: "setup" });
    fireEvent.click(
      within(cards[1]).getByRole("button", { name: "Close video" }),
    );
    expect(screen.queryByTestId("saved-player")).not.toBeInTheDocument();
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(
      within(cards[1]).getByRole("region", { name: "Answer feedback" }),
    ).toBeVisible();
    expect(saved).toEqual(immutable);
    expect(fetcher).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
  it("unmounts replay when its recap disclosure is closed", () => {
    const saved = snapshot("completed");
    render(
      <SessionRecap
        items={saved.items}
        sessionId={saved.id}
        viewerId={viewer.id}
        onRestart={vi.fn()}
      />,
    );
    const card =
      document.querySelector<HTMLDetailsElement>("details.recap-card")!;
    fireEvent.click(within(card).getByText(saved.items[0].challenge.title));
    fireEvent.click(within(card).getByRole("button", { name: "Watch setup" }));
    card.open = false;
    fireEvent(card, new Event("toggle"));
    expect(screen.queryByTestId("saved-player")).not.toBeInTheDocument();
  });
});
