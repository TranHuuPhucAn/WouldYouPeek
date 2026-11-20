import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { PlaylistLibrary } from "@/components/library/PlaylistLibrary";
import { PlaylistDashboard } from "@/components/creator/PlaylistDashboard";
import { SessionHistory } from "@/components/sessions/SessionHistory";
import * as publicApi from "@/lib/client/playlist-api";
import * as ownerApi from "@/lib/client/creator-playlist-api";
import {
  preview,
  playlistSnapshot,
  playlistSession,
  candidate,
  playlistId,
} from "./playlist-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/playlist-api", () => ({ listLibraryPlaylists: vi.fn() }));
vi.mock("@/lib/client/creator-playlist-api", () => ({
  listCreatorPlaylists: vi.fn(),
  createCreatorPlaylist: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => vi.clearAllMocks());
describe("playlist discovery and owner dashboard", () => {
  it("keeps a mixed collection complete through an exact player filter and deduplicates pagination", async () => {
    const item = preview();
    const next = {
      ...item,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "Next collection",
    };
    vi.mocked(publicApi.listLibraryPlaylists).mockResolvedValue({
      playlists: [item, next],
      nextCursor: null,
    });
    render(
      <PlaylistLibrary
        initial={{ playlists: [item], nextCursor: "second" }}
        playerId={candidate().player.id}
      />,
    );
    expect(screen.getByRole("link", { name: "aspas" })).toHaveAttribute(
      "href",
      `/library/players/${candidate(1).player.id}?view=playlists`,
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Load more playlists" }),
    );
    await screen.findByRole("link", { name: "Next collection" });
    expect(screen.getAllByRole("link", { name: item.title })).toHaveLength(1);
    expect(publicApi.listLibraryPlaylists).toHaveBeenCalledWith(
      { query: "", playerId: candidate().player.id, cursor: "second" },
      expect.any(AbortSignal),
    );
  });
  it("retains results after a failed page and aborts the retry on unmount", async () => {
    vi.mocked(publicApi.listLibraryPlaylists)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise(() => {}));
    const view = render(
      <PlaylistLibrary
        initial={{ playlists: [preview()], nextCursor: "second" }}
        query="TenZ"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Load more playlists" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry loading playlists" }),
    );
    expect(
      screen.getByRole("link", { name: preview().title }),
    ).toBeInTheDocument();
    view.unmount();
    expect(
      vi.mocked(publicApi.listLibraryPlaylists).mock.calls[1][1]?.aborted,
    ).toBe(true);
  });
  it("recovers create result without duplicating drafts, then clears private dashboard on identity loss", async () => {
    vi.mocked(ownerApi.createCreatorPlaylist)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        playlist: playlistSnapshot(0),
        replayed: true,
        publishedVersion: null,
      });
    render(<PlaylistDashboard initial={{ playlists: [], nextCursor: null }} />);
    fireEvent.click(screen.getByRole("button", { name: /New playlist/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry creating draft" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        `/creator/playlists/${playlistId}`,
      ),
    );
    expect(vi.mocked(ownerApi.createCreatorPlaylist).mock.calls[1][0]).toEqual(
      vi.mocked(ownerApi.createCreatorPlaylist).mock.calls[0][0],
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(
      screen.queryByRole("button", { name: /New playlist/ }),
    ).not.toBeInTheDocument();
  });
  it("shows saved playlist title and credit in History without consulting the current publication", () => {
    const saved = playlistSession();
    render(
      <SessionHistory
        initialHistory={{
          sessions: [
            {
              id: saved.id,
              target: saved.target,
              title: saved.title,
              status: saved.status,
              answeredCount: 0,
              totalCount: saved.items.length,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
              completedAt: null,
              playlist: saved.playlist,
            },
          ],
          nextCursor: null,
        }}
      />,
    );
    expect(screen.getByText(/Playlist by Coach Example/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Resume session/ }),
    ).toHaveAttribute("href", `/play/${saved.id}`);
    expect(publicApi.listLibraryPlaylists).not.toHaveBeenCalled();
  });
});
