import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioLibrary } from "@/components/library/ScenarioLibrary";
import { ScenarioStart } from "@/components/library/ScenarioStart";
import * as library from "@/lib/client/library-api";
import * as session from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import { libraryEntry, creatorId, commandId } from "./creator-fixtures";
import { sessionSummary, snapshot, viewer } from "./session-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/library-api", () => ({ listLibraryScenarios: vi.fn() }));
vi.mock("@/lib/client/session-api", () => ({ createOrResumeSession: vi.fn() }));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  router.push.mockReset();
  vi.mocked(session.createOrResumeSession)
    .mockReset()
    .mockResolvedValue({ session: snapshot(), replayed: false, created: true });
  vi.mocked(library.listLibraryScenarios).mockReset();
});
describe("published library", () => {
  it("offers all players when a player collection is empty", () => {
    render(<ScenarioLibrary initial={{ scenarios: [], nextCursor: null }} />);
    expect(
      screen.getByRole("link", { name: "Browse all players →" }),
    ).toHaveAttribute("href", "/library");
  });
  it("shows attribution without outcomes and deduplicates pagination", async () => {
    const next = {
      ...libraryEntry(),
      id: commandId,
      title: "Second scenario",
      provenance: "ai-assisted" as const,
    };
    vi.mocked(library.listLibraryScenarios).mockResolvedValue({
      scenarios: [libraryEntry(), next],
      nextCursor: null,
    });
    render(
      <ScenarioLibrary
        initial={{ scenarios: [libraryEntry()], nextCursor: "next" }}
      />,
    );
    expect(screen.queryByText(/Meddle is visibly/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Load more scenarios" }),
    );
    await screen.findByRole("link", { name: "Second scenario" });
    expect(
      screen.getByText("Creator-reviewed · AI-assisted"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: libraryEntry().title }),
    ).toHaveLength(1);
    expect(library.listLibraryScenarios).toHaveBeenCalledWith(
      { cursor: "next", playerId: undefined },
      expect.any(AbortSignal),
    );
  });
  it("keeps the public catalogue available after identity changes", async () => {
    let resolve!: (
      v: Awaited<ReturnType<typeof library.listLibraryScenarios>>,
    ) => void;
    vi.mocked(library.listLibraryScenarios).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    render(
      <ScenarioLibrary
        initial={{ scenarios: [libraryEntry()], nextCursor: "next" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load more scenarios" }),
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    await act(async () =>
      resolve({ scenarios: [libraryEntry()], nextCursor: null }),
    );
    expect(screen.getByText(libraryEntry().title)).toBeInTheDocument();
  });
});
describe("selected scenario starts", () => {
  it("sends the selected target and reuses the command after an interrupted response", async () => {
    vi.mocked(session.createOrResumeSession).mockRejectedValueOnce(
      new Error("Lost reply"),
    );
    render(<ScenarioStart scenarioId={creatorId} viewer={viewer} />);
    fireEvent.click(screen.getByRole("button", { name: "Start scenario →" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry starting scenario" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/play/${snapshot().id}`),
    );
    const calls = vi.mocked(session.createOrResumeSession).mock.calls;
    expect(calls[0][0].target).toEqual({
      kind: "scenario",
      scenarioId: creatorId,
    });
    expect(calls[1][0]).toEqual(calls[0][0]);
  });
  it("keeps an active different target explicit and offers its owned resume link", async () => {
    vi.mocked(session.createOrResumeSession).mockRejectedValue(
      new ApiClientError("ACTIVE_SESSION_EXISTS", "Active", 409, {
        activeSession: sessionSummary(),
      }),
    );
    render(<ScenarioStart scenarioId={creatorId} viewer={viewer} />);
    fireEvent.click(screen.getByRole("button", { name: "Start scenario →" }));
    expect(
      await screen.findByRole("link", { name: "Resume current session →" }),
    ).toHaveAttribute("href", `/play/${snapshot().id}`);
    expect(screen.getByText(/Finish your current session/)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /Retry starting/ }),
    ).not.toBeInTheDocument();
  });
  it("prevents retrying a withdrawn scenario while preserving history explanation", async () => {
    vi.mocked(session.createOrResumeSession).mockRejectedValue(
      new ApiClientError("SCENARIO_UNAVAILABLE", "Withdrawn", 404),
    );
    render(<ScenarioStart scenarioId={creatorId} viewer={viewer} />);
    fireEvent.click(screen.getByRole("button", { name: "Start scenario →" }));
    await screen.findByText(/no longer available for new sessions/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toBeInTheDocument();
  });
  it("suppresses duplicate starts and ignores a response after unmount", async () => {
    let resolve!: (
      v: Awaited<ReturnType<typeof session.createOrResumeSession>>,
    ) => void;
    vi.mocked(session.createOrResumeSession).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const view = render(
      <ScenarioStart scenarioId={creatorId} viewer={viewer} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start scenario →" }));
    fireEvent.click(screen.getByRole("button", { name: "Opening…" }));
    expect(session.createOrResumeSession).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () =>
      resolve({ session: snapshot(), created: true, replayed: false }),
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(
      vi.mocked(session.createOrResumeSession).mock.calls[0][1]?.aborted,
    ).toBe(true);
  });
});

it.each([null, { ...viewer, emailVerified: false }])(
  "requires verified sign-in before starting a public scenario",
  (account) => {
    render(<ScenarioStart scenarioId={creatorId} viewer={account} />);
    const link = screen.getByRole("link", {
      name: account ? /Verify email to play/ : /Sign in to play/,
    });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe(account ? "/check-email" : "/sign-in");
    expect(url.searchParams.get("returnTo")).toBe(`/library/${creatorId}`);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(session.createOrResumeSession).not.toHaveBeenCalled();
  },
);
