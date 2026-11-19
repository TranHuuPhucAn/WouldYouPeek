import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatorReview } from "@/components/creator/CreatorReview";
import * as api from "@/lib/client/creator-api";
import { ApiClientError } from "@/lib/client/api-response";
import {
  creatorSnapshot,
  creatorPreview,
  creatorId,
  reviewId,
  allChecked,
  when,
} from "./creator-fixtures";
vi.mock("@/lib/client/creator-api", () => ({
  getCreatorReview: vi.fn(),
  getCreatorScenario: vi.fn(),
  reviewCreatorScenario: vi.fn(),
  publishCreatorScenario: vi.fn(),
  unpublishCreatorScenario: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
vi.mock("@/components/creator/ScenarioPreview", () => ({
  ScenarioPreview: () => (
    <input aria-label="Preview state marker" defaultValue="preserved" />
  ),
}));
beforeEach(() => {
  vi.mocked(api.reviewCreatorScenario)
    .mockReset()
    .mockResolvedValue({
      scenario: creatorSnapshot(true, true),
      replayed: false,
      publishedVersion: null,
    });
  vi.mocked(api.publishCreatorScenario)
    .mockReset()
    .mockResolvedValue({
      scenario: published(),
      replayed: false,
      publishedVersion: "creator-1",
    });
  vi.mocked(api.unpublishCreatorScenario)
    .mockReset()
    .mockResolvedValue({
      scenario: withdrawn(),
      replayed: false,
      publishedVersion: null,
    });
  vi.mocked(api.getCreatorScenario)
    .mockReset()
    .mockResolvedValue(creatorSnapshot());
  vi.mocked(api.getCreatorReview)
    .mockReset()
    .mockResolvedValue(creatorPreview());
});
function published() {
  const s = creatorSnapshot(true, true);
  s.revision = 3;
  s.publication = {
    state: "published",
    currentVersion: "creator-1",
    publishedAt: when,
    hasUnpublishedChanges: false,
  };
  return s;
}
function withdrawn() {
  const s = published();
  s.revision = 4;
  s.review = null;
  s.publication.state = "withdrawn";
  return s;
}
function renderReview(s = creatorSnapshot()) {
  return render(
    <CreatorReview
      initial={s}
      initialPreview={s.readiness.canReview ? creatorPreview(s) : null}
      viewerId="owner"
    />,
  );
}
function checkAll() {
  for (const input of screen.getAllByRole("checkbox")) fireEvent.click(input);
}
describe("review and publication controls", () => {
  it("requires all seven checks, persists the exact saved revision, and publishes with its review receipt", async () => {
    renderReview();
    expect(api.reviewCreatorScenario).not.toHaveBeenCalled();
    const mark = screen.getByRole("button", { name: "Mark reviewed" });
    expect(mark).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Publish scenario" }),
    ).toBeDisabled();
    checkAll();
    fireEvent.change(screen.getByLabelText("Preview state marker"), {
      target: { value: "Still at continuation" },
    });
    fireEvent.click(mark);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "This revision is reviewed" }),
      ).toBeInTheDocument(),
    );
    expect(api.reviewCreatorScenario).toHaveBeenCalledWith(
      creatorId,
      {
        requestId: expect.any(String),
        expectedRevision: 1,
        checklist: allChecked(),
      },
      expect.any(AbortSignal),
    );
    expect(screen.getByLabelText("Preview state marker")).toHaveValue(
      "Still at continuation",
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish scenario" }));
    await waitFor(() =>
      expect(api.publishCreatorScenario).toHaveBeenCalledTimes(1),
    );
    expect(api.publishCreatorScenario).toHaveBeenCalledWith(
      creatorId,
      { requestId: expect.any(String), expectedRevision: 2, reviewId },
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Publish update" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByText(/Publication confirmed \(creator-1\)/),
    ).toBeInTheDocument();
  });
  it("does not allow review or publication of incomplete drafts", () => {
    renderReview(creatorSnapshot(false));
    expect(
      screen.getByRole("heading", { name: "Complete the draft before review" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Preview state marker"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark reviewed" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Publish scenario" }),
    ).toBeDisabled();
  });
  it("recovers a lost publication response using the same UUID and review receipt", async () => {
    vi.mocked(api.publishCreatorScenario).mockRejectedValueOnce(
      new Error("Lost reply"),
    );
    renderReview(creatorSnapshot(true, true));
    fireEvent.click(screen.getByRole("button", { name: "Publish scenario" }));
    await screen.findByRole("button", { name: "Retry the same action" });
    const command = vi.mocked(api.publishCreatorScenario).mock.calls[0][1];
    expect(
      screen.getByRole("button", { name: "Publish scenario" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry the same action" }),
    );
    await waitFor(() =>
      expect(api.publishCreatorScenario).toHaveBeenCalledTimes(2),
    );
    expect(vi.mocked(api.publishCreatorScenario).mock.calls[1][1]).toEqual(
      command,
    );
  });
  it("keeps stale review blocked until latest saved content has been loaded", async () => {
    vi.mocked(api.publishCreatorScenario).mockRejectedValueOnce(
      new ApiClientError("SCENARIO_CONFLICT", "Changed", 409),
    );
    const latest = creatorSnapshot();
    latest.revision = 3;
    latest.draft.revision = 2;
    latest.draft.content.title = "Changed in another tab";
    vi.mocked(api.getCreatorScenario).mockResolvedValue(latest);
    vi.mocked(api.getCreatorReview).mockResolvedValue(creatorPreview(latest));
    renderReview(creatorSnapshot(true, true));
    fireEvent.click(screen.getByRole("button", { name: "Publish scenario" }));
    await screen.findByRole("button", { name: "Reload latest review" });
    expect(
      screen.getByRole("button", { name: "Publish scenario" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload latest review" }),
    );
    await screen.findByRole("heading", { name: "Changed in another tab" });
    expect(api.getCreatorReview).toHaveBeenCalledWith(
      creatorId,
      3,
      expect.any(AbortSignal),
    );
    expect(
      screen
        .getAllByRole("checkbox")
        .every((input) => !(input as HTMLInputElement).checked),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Mark reviewed" }),
    ).toBeDisabled();
  });
  it("requires inline confirmation to unpublish and clears review after withdrawal", async () => {
    renderReview(published());
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(api.unpublishCreatorScenario).not.toHaveBeenCalled();
    expect(
      screen.getByRole("group", { name: "Confirm unpublish" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep published" }));
    expect(api.unpublishCreatorScenario).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm unpublish" }));
    await waitFor(() =>
      expect(api.unpublishCreatorScenario).toHaveBeenCalledTimes(1),
    );
    await screen.findByText(
      "Scenario withdrawn. Existing learner sessions keep their saved content.",
    );
    expect(
      screen.getByRole("button", { name: "Publish scenario" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: /View library/ }),
    ).not.toBeInTheDocument();
  });
  it("provides a reload path when a recovered command returns newer content", async () => {
    const latest = published();
    latest.revision = 4;
    latest.draft.revision = 2;
    latest.review = null;
    latest.publication.hasUnpublishedChanges = true;
    vi.mocked(api.publishCreatorScenario).mockResolvedValue({
      scenario: latest,
      replayed: true,
      publishedVersion: "creator-1",
    });
    renderReview(creatorSnapshot(true, true));
    fireEvent.click(screen.getByRole("button", { name: "Publish scenario" }));
    await screen.findByRole("button", { name: "Reload latest review" });
    expect(
      screen.queryByLabelText("Preview state marker"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Publish update" }),
    ).toBeDisabled();
  });
  it("clears preview and ignores a late response after identity invalidation", async () => {
    let resolve!: (
      v: Awaited<ReturnType<typeof api.reviewCreatorScenario>>,
    ) => void;
    vi.mocked(api.reviewCreatorScenario).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    renderReview();
    checkAll();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    await act(async () =>
      resolve({
        scenario: creatorSnapshot(true, true),
        replayed: false,
        publishedVersion: null,
      }),
    );
    expect(
      screen.queryByLabelText("Preview state marker"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish scenario" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/creator session has changed/)).toBeInTheDocument();
  });
});
