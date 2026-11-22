import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorDashboard } from "@/components/creator/CreatorDashboard";
import { CreatorStatus } from "@/components/creator/CreatorStatus";
import * as api from "@/lib/client/creator-api";
import { ApiClientError } from "@/lib/client/api-response";
import {
  creatorSnapshot,
  creatorSummary,
  creatorId,
  commandId,
  when,
} from "./creator-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/creator-api", () => ({
  createCreatorScenario: vi.fn(),
  listCreatorScenarios: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.mocked(api.createCreatorScenario)
    .mockReset()
    .mockResolvedValue({
      scenario: creatorSnapshot(false),
      replayed: false,
      publishedVersion: null,
    });
  vi.mocked(api.listCreatorScenarios)
    .mockReset()
    .mockResolvedValue({ scenarios: [], nextCursor: null });
  router.push.mockReset();
});
describe("creator dashboard", () => {
  it("never creates on render, then suppresses duplicate creation clicks", async () => {
    let resolve!: (
      v: Awaited<ReturnType<typeof api.createCreatorScenario>>,
    ) => void;
    vi.mocked(api.createCreatorScenario).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    render(<CreatorDashboard initial={{ scenarios: [], nextCursor: null }} />);
    expect(
      screen.getByText("Your first scenario starts with one moment."),
    ).toBeInTheDocument();
    expect(api.createCreatorScenario).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New scenario →" }));
    fireEvent.click(screen.getByRole("button", { name: "Creating…" }));
    expect(api.createCreatorScenario).toHaveBeenCalledTimes(1);
    await act(async () =>
      resolve({
        scenario: creatorSnapshot(false),
        replayed: false,
        publishedVersion: null,
      }),
    );
    expect(router.push).toHaveBeenCalledWith(`/creator/scenarios/${creatorId}`);
  });
  it("uses the same creation UUID after a lost reply", async () => {
    vi.mocked(api.createCreatorScenario).mockRejectedValueOnce(
      new Error("Lost reply"),
    );
    render(<CreatorDashboard initial={{ scenarios: [], nextCursor: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "New scenario →" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry creating draft" }),
    );
    await waitFor(() =>
      expect(api.createCreatorScenario).toHaveBeenCalledTimes(2),
    );
    expect(vi.mocked(api.createCreatorScenario).mock.calls[1][0]).toEqual(
      vi.mocked(api.createCreatorScenario).mock.calls[0][0],
    );
  });
  it("binds each fixed filter to a fresh cursor and ignores a delayed older response", async () => {
    let oldResolve!: (
      v: Awaited<ReturnType<typeof api.listCreatorScenarios>>,
    ) => void;
    vi.mocked(api.listCreatorScenarios)
      .mockImplementationOnce(() => new Promise((r) => (oldResolve = r)))
      .mockResolvedValueOnce({ scenarios: [], nextCursor: null });
    render(
      <CreatorDashboard
        initial={{ scenarios: [creatorSummary()], nextCursor: "old-cursor" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Published" }));
    fireEvent.click(screen.getByRole("button", { name: "Withdrawn" }));
    await waitFor(() =>
      expect(
        screen.getByText("No scenarios in this view yet."),
      ).toBeInTheDocument(),
    );
    await act(async () =>
      oldResolve({ scenarios: [creatorSummary()], nextCursor: "stale" }),
    );
    expect(screen.queryByText(creatorSummary().title)).not.toBeInTheDocument();
    expect(
      vi
        .mocked(api.listCreatorScenarios)
        .mock.calls.map((call) => call.slice(0, 2)),
    ).toEqual([
      [null, "published"],
      [null, "withdrawn"],
    ]);
    expect(vi.mocked(api.listCreatorScenarios).mock.calls[0][2]?.aborted).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Private drafts" }));
    await waitFor(() =>
      expect(api.listCreatorScenarios).toHaveBeenLastCalledWith(
        null,
        "unpublished",
        expect.any(AbortSignal),
      ),
    );
  });
  it("appends unique rows on pagination", async () => {
    const next = {
      ...creatorSummary(),
      id: commandId,
      title: "Another moment",
    };
    vi.mocked(api.listCreatorScenarios).mockResolvedValue({
      scenarios: [creatorSummary(), next],
      nextCursor: null,
    });
    render(
      <CreatorDashboard
        initial={{ scenarios: [creatorSummary()], nextCursor: "next" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load more scenarios" }),
    );
    await screen.findByRole("link", { name: "Another moment" });
    expect(
      screen.getAllByRole("link", { name: creatorSummary().title }),
    ).toHaveLength(1);
    expect(api.listCreatorScenarios).toHaveBeenCalledWith(
      "next",
      "all",
      expect.any(AbortSignal),
    );
  });
  it("removes owner rows when role access expires", async () => {
    vi.mocked(api.listCreatorScenarios).mockRejectedValue(
      new ApiClientError("CREATOR_REQUIRED", "Expired", 403),
    );
    render(
      <CreatorDashboard
        initial={{ scenarios: [creatorSummary()], nextCursor: "next" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load more scenarios" }),
    );
    await screen.findByText(/Refreshing creator access/);
    expect(screen.queryByText(creatorSummary().title)).not.toBeInTheDocument();
  });
  it("shows live publication separately from unsaved publication updates", () => {
    render(
      <CreatorStatus
        publication={{
          state: "published",
          currentVersion: "creator-1",
          publishedAt: when,
          hasUnpublishedChanges: true,
          operatorVisibility: { hidden: false, reason: null, changedAt: null },
        }}
        reviewed={false}
        canReview={true}
      />,
    );
    expect(screen.getByText(/^Published ·/)).toBeInTheDocument();
    expect(screen.getByText(/Unpublished changes/)).toBeInTheDocument();
  });
});
