import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LibraryScenarioDetail } from "@/components/library/LibraryScenarioDetail";
import { LibraryMediaPreview } from "@/components/library/LibraryMediaPreview";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
import { SessionStart } from "@/components/sessions/SessionStart";
import { ScenarioInteractionScope } from "@/components/library/ScenarioInteractionScope";
import { libraryEntry, creatorId } from "./creator-fixtures";
import { snapshot, sessionSummary, viewer } from "./session-fixtures";
import { receipt } from "./moderation-fixtures";
const media = vi.hoisted(() => vi.fn());
vi.mock("@/components/challenge/ScenarioMedia", () => ({
  ScenarioMedia: (props: unknown) => {
    media(props);
    return <div data-testid="preview" />;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => media.mockClear());
function renderPreview() {
  return render(
    <LibraryMediaPreview scenario={libraryEntry()} viewer={viewer} />,
  );
}
it("requires guest sign-in but leaves public preview usable", () => {
  render(<LibraryMediaPreview scenario={libraryEntry()} viewer={null} />);
  expect(
    screen.getByRole("link", { name: "Sign in to report a problem" }),
  ).toHaveAttribute(
    "href",
    `/sign-in?returnTo=${encodeURIComponent(`/library/${creatorId}`)}`,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("pauses during reporting and preserves the text after validation and retry", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(Response.json(receipt()));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  renderPreview();
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  expect(media.mock.lastCall?.[0]).toMatchObject({ suspended: true });
  await user.selectOptions(screen.getByLabelText("Problem type"), "other");
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  expect(await screen.findByText("Please describe the problem.")).toBeVisible();
  await user.type(screen.getByLabelText(/Details/), "The pause is late.");
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  await user.click(await screen.findByRole("button", { name: "Retry report" }));
  expect(await screen.findByText(/Report received/)).toBeVisible();
  expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(media.mock.lastCall?.[0]).toMatchObject({ suspended: false });
  expect(
    screen.getByRole("button", { name: "Report a problem" }),
  ).toHaveFocus();
});
it("keeps an uncertain report alive when its dialog closes", async () => {
  let respond!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  renderPreview();
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  await user.keyboard("{Escape}");
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  expect(screen.getByText("Sending or checking your report…")).toBeVisible();
  await act(async () => respond(Response.json(receipt())));
  expect(screen.getByText(/Report received/)).toBeVisible();
});
it("refreshes a changed publication only after explicit target confirmation", async () => {
  const latest = {
    ...libraryEntry(),
    contentVersion: "creator-2",
    title: "The revised scenario title",
    source: { ...libraryEntry().source!, uploader: "Updated source credit" },
    context: "Updated context for review.",
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: "REPORT_TARGET_CHANGED", message: "Changed" } },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(Response.json(latest))
    .mockResolvedValueOnce(Response.json(receipt()));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<LibraryScenarioDetail scenario={libraryEntry()} viewer={viewer} />);
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  await user.type(screen.getByLabelText(/Details/), "Keep this explanation.");
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  await user.click(
    await screen.findByRole("button", { name: "Check latest version" }),
  );
  expect(await screen.findByText(latest.context)).toBeVisible();
  expect(screen.getByLabelText(/Details/)).toHaveValue(
    "Keep this explanation.",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    libraryEntry().title,
  );
  await user.click(
    screen.getByRole("button", { name: "Use this updated version" }),
  );
  expect(screen.getByLabelText(/Details/)).toHaveFocus();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    latest.title,
  );
  expect(screen.getByText(latest.context)).toBeVisible();
  expect(screen.queryByText(libraryEntry().context)).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Updated source credit/ }),
  ).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  expect(JSON.parse(fetcher.mock.calls[2][1].body).target.contentVersion).toBe(
    "creator-2",
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body).requestId).not.toBe(
    JSON.parse(fetcher.mock.calls[2][1].body).requestId,
  );
});
it("clears private report text on identity change and ignores a late receipt", async () => {
  let respond!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  renderPreview();
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  await user.type(screen.getByLabelText(/Details/), "Private draft text");
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
  await act(async () => respond(Response.json(receipt())));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/Report received/)).not.toBeInTheDocument();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it("suspends a sibling Library preview while an active-session End dialog is open", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "ACTIVE_SESSION_EXISTS",
            message: "Active",
            details: { activeSession: sessionSummary() },
          },
        },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(Response.json(snapshot()));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(
    <ScenarioInteractionScope>
      <LibraryMediaPreview scenario={libraryEntry()} viewer={viewer} />
      <SessionStart
        viewer={viewer}
        target={{ kind: "scenario", scenarioId: creatorId }}
        returnTo={`/library/${creatorId}`}
      />
    </ScenarioInteractionScope>,
  );
  await user.click(screen.getByRole("button", { name: /Start scenario/ }));
  await user.click(
    await screen.findByRole("button", { name: "End current session" }),
  );
  await screen.findByRole("dialog");
  expect(media.mock.lastCall?.[0]).toMatchObject({ suspended: true });
  await user.keyboard("{Escape}");
  expect(media.mock.lastCall?.[0]).toMatchObject({ suspended: false });
});
it("reports the owned current item without submitting an answer", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(receipt()));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ChallengePlayer initialSession={snapshot()} viewer={viewer} />);
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Submit report",
    }),
  );
  expect(await screen.findByText(/Report received/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).target).toEqual({
    kind: "session-item",
    sessionId: snapshot().id,
    itemId: snapshot().items[0].id,
  });
});
it("reports only an answered historical item in an ended recap and keeps its analysis expanded", async () => {
  const ended = snapshot("ended", 1),
    fetcher = vi
      .fn()
      .mockResolvedValue(Response.json(receipt({ duplicate: true })));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<ChallengePlayer initialSession={ended} viewer={viewer} />);
  const summary = screen.getByText(ended.items[0].challenge.title);
  await user.click(summary);
  expect(
    screen.getAllByRole("button", { name: "Report a problem" }),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Submit report",
    }),
  );
  expect(await screen.findByText(/Already reported/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).target).toEqual({
    kind: "session-item",
    sessionId: ended.id,
    itemId: ended.items[0].id,
  });
});
it("resets a received report without submitting again until the learner explicitly submits", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json(receipt()));
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  renderPreview();
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  await user.selectOptions(
    screen.getByLabelText("Problem type"),
    "analysis_issue",
  );
  await user.type(screen.getByLabelText(/Details/), "Review this alternative.");
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  await screen.findByText(/Report received/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const reset = screen.getByRole("button", { name: "Report another issue" });
  await user.click(reset);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Report received/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Problem type")).toBeEnabled();
  expect(screen.getByLabelText(/Details/)).toHaveValue("");
  expect(screen.getByRole("button", { name: "Submit report" })).not.toBe(reset);
  expect(screen.getByLabelText("Problem type")).toHaveFocus();
  await user.selectOptions(screen.getByLabelText("Problem type"), "other");
  await user.type(screen.getByLabelText(/Details/), "A separate issue.");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Submit report" }));
  await screen.findByText(/Report received/);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const first = JSON.parse(fetcher.mock.calls[0][1].body),
    second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(second.requestId).not.toBe(first.requestId);
  expect(second).toMatchObject({
    category: "other",
    detail: "A separate issue.",
    target: first.target,
  });
});
