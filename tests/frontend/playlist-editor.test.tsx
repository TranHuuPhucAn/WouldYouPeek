import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { PlaylistEditor } from "@/components/creator/PlaylistEditor";
import { PlaylistScenarioPicker } from "@/components/creator/PlaylistScenarioPicker";
import * as api from "@/lib/client/creator-playlist-api";
import { ApiClientError } from "@/lib/client/api-response";
import { candidate, playlistSnapshot, playlistId } from "./playlist-fixtures";
vi.mock("@/lib/client/creator-playlist-api", () => ({
  saveCreatorPlaylist: vi.fn(),
  getCreatorPlaylist: vi.fn(),
  listPlaylistScenarioCandidates: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.saveCreatorPlaylist).mockImplementation(async (_id, input) => {
    const next = playlistSnapshot();
    next.revision = 2;
    next.draft = { ...next.draft, revision: 2, content: input.content };
    next.items = input.content.items.map((selection, position) => ({
      position,
      selection,
      preview: {
        ...candidate(Number(selection.scenarioId.slice(-2))),
        scenarioVersion: selection.scenarioVersion,
      },
      currentVersion: selection.scenarioVersion,
      issues: [],
    }));
    return { playlist: next, replayed: false, publishedVersion: null };
  });
});
function editor() {
  const initial = playlistSnapshot();
  initial.items[0].currentVersion = "creator-2";
  return render(
    <PlaylistEditor
      initial={initial}
      initialCandidates={{
        scenarios: [candidate(0), candidate(1), candidate(2)],
        nextCursor: null,
      }}
      profile={{ displayName: "Coach", revision: 1 }}
      viewerId="owner"
    />,
  );
}
describe("playlist editor interaction", () => {
  it("adds, reorders with keyboard focus, removes and saves explicit version updates", async () => {
    editor();
    expect(
      screen.getByRole("button", { name: "Added Decision 1" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add Decision 3" }));
    expect(
      screen.queryByRole("link", { name: /Review saved/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move Decision 3 up" }));
    expect(
      screen.getAllByRole("heading", { name: "Decision 3" })[0],
    ).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Remove Decision 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Update to latest" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByText("All changes saved.")).toBeInTheDocument(),
    );
    expect(api.saveCreatorPlaylist).toHaveBeenCalledWith(
      playlistId,
      expect.objectContaining({
        expectedRevision: 1,
        content: expect.objectContaining({
          items: [
            {
              scenarioId: candidate().scenarioId,
              scenarioVersion: "creator-2",
            },
            {
              scenarioId: candidate(2).scenarioId,
              scenarioVersion: "creator-1",
            },
          ],
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("link", { name: /Review saved/ }),
    ).toBeInTheDocument();
  });
  it("retries an uncertain save identically while preserving later typing", async () => {
    vi.mocked(api.saveCreatorPlaylist).mockRejectedValueOnce(
      new Error("Offline"),
    );
    editor();
    fireEvent.change(screen.getByLabelText("Playlist title"), {
      target: { value: "First title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText(/We couldn’t confirm this save/);
    fireEvent.change(screen.getByLabelText("Playlist title"), {
      target: { value: "Later title" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Retry the same save" }),
    );
    await waitFor(() =>
      expect(api.saveCreatorPlaylist).toHaveBeenCalledTimes(2),
    );
    expect(vi.mocked(api.saveCreatorPlaylist).mock.calls[1][1]).toEqual(
      vi.mocked(api.saveCreatorPlaylist).mock.calls[0][1],
    );
    expect(screen.getByLabelText("Playlist title")).toHaveValue("Later title");
    expect(
      screen.queryByRole("link", { name: /Review saved/ }),
    ).not.toBeInTheDocument();
  });
  it("retains local edits on conflict until explicit replacement and clears on identity loss", async () => {
    const latest = playlistSnapshot();
    latest.revision = 3;
    latest.draft.content.title = "Saved elsewhere";
    vi.mocked(api.getCreatorPlaylist).mockResolvedValue(latest);
    vi.mocked(api.saveCreatorPlaylist).mockRejectedValueOnce(
      new ApiClientError("PLAYLIST_CONFLICT", "Changed", 409),
    );
    editor();
    fireEvent.change(screen.getByLabelText("Playlist title"), {
      target: { value: "Local text" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Compare latest saved draft" }),
    );
    await screen.findByRole("heading", { name: "Latest saved draft" });
    expect(screen.getByLabelText("Playlist title")).toHaveValue("Local text");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace my edits with this saved draft",
      }),
    );
    expect(screen.getByLabelText("Playlist title")).toHaveValue(
      "Saved elsewhere",
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(screen.queryByLabelText("Playlist title")).not.toBeInTheDocument();
  });
  it("rejects a late picker search result and disables additions at twenty items", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.listPlaylistScenarioCandidates>>,
    ) => void;
    vi.mocked(api.listPlaylistScenarioCandidates)
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({ scenarios: [candidate(3)], nextCursor: null });
    render(
      <PlaylistScenarioPicker
        initial={{ scenarios: [], nextCursor: null }}
        selected={Array.from({ length: 20 }, (_, i) => candidate(i))}
        onAdd={vi.fn()}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByText("Decision 4");
    await act(async () =>
      resolve({ scenarios: [candidate(25)], nextCursor: null }),
    );
    expect(screen.queryByText("Decision 26")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Added Decision 4" }),
    ).toBeDisabled();
  });
});
