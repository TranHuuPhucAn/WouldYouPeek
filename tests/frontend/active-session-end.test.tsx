import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SessionStart } from "@/components/sessions/SessionStart";
import { creatorId, selectedSnapshot } from "./creator-fixtures";
import { sessionSummary, snapshot, viewer } from "./session-fixtures";
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
const conflict = () =>
  Response.json(
    {
      error: {
        code: "ACTIVE_SESSION_EXISTS",
        message: "Another session is active.",
        details: { activeSession: sessionSummary() },
      },
    },
    { status: 409 },
  );
function view() {
  render(
    <SessionStart
      viewer={viewer}
      target={{ kind: "scenario", scenarioId: creatorId }}
      returnTo={`/library/${creatorId}`}
    />,
  );
}

it("fetches a fresh revision, ends, then requires a separate explicit new start", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(conflict())
    .mockResolvedValueOnce(Response.json(snapshot("review")))
    .mockResolvedValueOnce(
      Response.json({
        session: { ...snapshot("ended", 1), revision: 2 },
        replayed: false,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        session: selectedSnapshot(),
        created: true,
        replayed: false,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.click(screen.getByRole("button", { name: /Start scenario/ }));
  await user.click(
    await screen.findByRole("button", { name: "End current session" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("1 of 3 decisions saved.")).toBeVisible();
  expect(fetcher.mock.calls[1][0]).toBe(`/api/sessions/${snapshot().id}`);
  await user.click(within(dialog).getByRole("button", { name: "End session" }));
  await screen.findByText(/Your previous session is closed/);
  expect(screen.getByRole("button", { name: /Start scenario/ })).toHaveFocus();
  expect(JSON.parse(fetcher.mock.calls[2][1].body).expectedRevision).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(router.push).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Start scenario/ }));
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(router.push).toHaveBeenCalledWith(`/play/${selectedSnapshot().id}`);
});
it("routes a fully answered current session to Finish instead of ending it", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(conflict())
    .mockResolvedValueOnce(Response.json(snapshot("review", 2)));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.click(screen.getByRole("button", { name: /Start scenario/ }));
  await user.click(
    await screen.findByRole("button", { name: "End current session" }),
  );
  expect(
    await screen.findByRole("link", { name: "Finish current session" }),
  ).toHaveAttribute("href", `/play/${snapshot().id}`);
  expect(
    screen.getByRole("link", { name: "Finish current session" }),
  ).toHaveFocus();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("keeps the command owner mounted when closing a pending conflict end", async () => {
  let respond!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(conflict())
    .mockResolvedValueOnce(Response.json(snapshot()))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.click(screen.getByRole("button", { name: /Start scenario/ }));
  await user.click(
    await screen.findByRole("button", { name: "End current session" }),
  );
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "End session",
    }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  expect(fetcher.mock.calls[2][1].signal.aborted).toBe(false);
  expect(screen.getByText("Ending your session…")).toBeVisible();
  expect(document.activeElement).toHaveClass("active-session-end");
  await act(async () =>
    respond(Response.json({ session: snapshot("ended"), replayed: false })),
  );
  expect(
    await screen.findByText(/Your previous session is closed/),
  ).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("cancel restores the end trigger and never writes to the session", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(conflict())
    .mockResolvedValueOnce(Response.json(snapshot()));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  view();
  await user.click(screen.getByRole("button", { name: /Start scenario/ }));
  await user.click(
    await screen.findByRole("button", { name: "End current session" }),
  );
  await screen.findByRole("dialog");
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: "End current session" }),
  ).toHaveFocus();
  expect(
    screen.getByRole("link", { name: /Resume current session/ }),
  ).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
