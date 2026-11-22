import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
import { SessionHistory } from "@/components/sessions/SessionHistory";
import { snapshot, sessionSummary, viewer } from "./session-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("end session experience", () => {
  it("cancels with keyboard focus and retains the unsubmitted choice", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ChallengePlayer initialSession={snapshot()} viewer={viewer} />);
    await user.click(
      screen.getByRole("button", { name: /Continue to decision/ }),
    );
    await user.click(screen.getByRole("radio", { name: "Hold the angle" }));
    const trigger = screen.getByRole("button", { name: "End session early" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "End this session?" });
    expect(within(dialog).getByText(/has not been submitted/)).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Keep practising" }),
    ).toHaveFocus();
    await user.tab({ shift: true });
    expect(
      within(dialog).getByRole("button", { name: "End session" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Hold the angle" })).toBeChecked();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps the end command alive after Close and shows an honest partial recap", async () => {
    let respond!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(
      <ChallengePlayer initialSession={snapshot("setup", 1)} viewer={viewer} />,
    );
    await user.click(screen.getByRole("button", { name: "End session early" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "End session",
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Ending your session…")).toBeVisible();
    expect(document.activeElement).toHaveClass("session-end-action");
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    await act(async () =>
      respond(
        Response.json({ session: snapshot("ended", 1), replayed: false }),
      ),
    );
    expect(screen.getByText("ENDED EARLY")).toBeVisible();
    expect(screen.getByText(/1 of 3 decisions saved/)).toBeVisible();
    expect(screen.getByText("Hold the advantage")).toBeVisible();
    expect(
      screen.queryByText("Missed shot. New angle."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SESSION COMPLETE")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalled();
  });
  it("restores zero-answer ended sessions without playable or review content", () => {
    render(
      <ChallengePlayer initialSession={snapshot("ended")} viewer={viewer} />,
    );
    expect(screen.getByText(/No decisions were saved/)).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /Watch|Continue to decision|End session early/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("More perspective.")).not.toBeInTheDocument();
  });
  it("keeps Finish for a fully answered review", () => {
    render(
      <ChallengePlayer
        initialSession={snapshot("review", 2)}
        viewer={viewer}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Finish session/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "End session early" }),
    ).not.toBeInTheDocument();
  });
  it("removes private state and ignores a late end result after identity loss", async () => {
    let respond!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<ChallengePlayer initialSession={snapshot()} viewer={viewer} />);
    await user.click(screen.getByRole("button", { name: "End session early" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "End session",
      }),
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () =>
      respond(Response.json({ session: snapshot("ended"), replayed: false })),
    );
    expect(
      screen.getByRole("heading", { name: "Sign in to continue." }),
    ).toBeVisible();
    expect(screen.queryByText("ENDED EARLY")).not.toBeInTheDocument();
  });
  it("labels ended History without a Resume action", () => {
    render(
      <SessionHistory
        initialHistory={{
          sessions: [sessionSummary("ended")],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByText("ENDED EARLY")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /View ended session/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Resume/ }),
    ).not.toBeInTheDocument();
  });
});
