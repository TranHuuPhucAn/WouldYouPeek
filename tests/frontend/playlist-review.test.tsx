import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { PlaylistReview } from "@/components/creator/PlaylistReview";
import * as api from "@/lib/client/creator-playlist-api";
import { ApiClientError } from "@/lib/client/api-response";
import {
  playlistSnapshot,
  reviewPreview,
  checklist,
  playlistId,
  reviewId,
  publicationId,
  when,
} from "./playlist-fixtures";
vi.mock("@/lib/client/creator-playlist-api", () => ({
  getCreatorPlaylistReview: vi.fn(),
  getCreatorPlaylist: vi.fn(),
  publishCreatorPlaylist: vi.fn(),
  reviewCreatorPlaylist: vi.fn(),
  unpublishCreatorPlaylist: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
function published() {
  const value = playlistSnapshot(2, true);
  value.revision = 3;
  value.publication = {
    state: "published",
    currentVersion: publicationId,
    publishedAt: when,
    hasUnpublishedChanges: false,
    availability: "available",
    issues: [],
  };
  return value;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.reviewCreatorPlaylist).mockResolvedValue({
    playlist: playlistSnapshot(2, true),
    replayed: false,
    publishedVersion: null,
  });
  vi.mocked(api.publishCreatorPlaylist).mockResolvedValue({
    playlist: published(),
    replayed: false,
    publishedVersion: publicationId,
  });
  const withdrawn = published();
  withdrawn.revision = 4;
  withdrawn.publication.state = "withdrawn";
  withdrawn.review = null;
  vi.mocked(api.unpublishCreatorPlaylist).mockResolvedValue({
    playlist: withdrawn,
    replayed: false,
    publishedVersion: null,
  });
  vi.mocked(api.getCreatorPlaylist).mockResolvedValue(playlistSnapshot());
  vi.mocked(api.getCreatorPlaylistReview).mockResolvedValue(reviewPreview());
});
function setup() {
  render(
    <PlaylistReview
      initial={playlistSnapshot()}
      initialPreview={reviewPreview()}
      viewerId="owner"
    />,
  );
}
function checks() {
  screen.getAllByRole("checkbox").forEach((input) => fireEvent.click(input));
}
describe("playlist review and publication", () => {
  it("reviews exact draft and public-name revision before publishing and withdrawing", async () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Mark reviewed" }),
    ).toBeDisabled();
    expect(screen.queryByRole("iframe")).not.toBeInTheDocument();
    checks();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await screen.findByRole("button", { name: "This revision is reviewed" });
    expect(api.reviewCreatorPlaylist).toHaveBeenCalledWith(
      playlistId,
      {
        requestId: expect.any(String),
        expectedRevision: 1,
        profileRevision: 1,
        checklist: checklist(),
      },
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish playlist" }));
    await screen.findByText(/Playlist published/);
    expect(api.publishCreatorPlaylist).toHaveBeenCalledWith(
      playlistId,
      { requestId: expect.any(String), expectedRevision: 2, reviewId },
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByText(publicationId, { exact: false }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish playlist" }));
    await screen.findByText(/Playlist withdrawn/);
    expect(
      screen.queryByRole("link", { name: /View published playlist/ }),
    ).not.toBeInTheDocument();
  });
  it("recovers an unknown publish outcome with exactly the same command", async () => {
    vi.mocked(api.publishCreatorPlaylist).mockRejectedValueOnce(
      new Error("Offline"),
    );
    render(
      <PlaylistReview
        initial={playlistSnapshot(2, true)}
        initialPreview={reviewPreview(playlistSnapshot(2, true))}
        viewerId="owner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish playlist" }));
    const retry = await screen.findByRole("button", {
      name: "Retry the same action",
    });
    expect(
      screen.getByRole("button", { name: "Publish playlist" }),
    ).toBeDisabled();
    fireEvent.click(retry);
    await screen.findByText(/Playlist published/);
    expect(vi.mocked(api.publishCreatorPlaylist).mock.calls[1][1]).toEqual(
      vi.mocked(api.publishCreatorPlaylist).mock.calls[0][1],
    );
  });
  it("requires reload on profile/revision conflict and does not replace visible metadata silently", async () => {
    vi.mocked(api.reviewCreatorPlaylist).mockRejectedValueOnce(
      new ApiClientError("PLAYLIST_CONFLICT", "Changed", 409),
    );
    const next = reviewPreview();
    next.profileRevision = 2;
    next.credit = { kind: "creator", displayName: "New name" };
    vi.mocked(api.getCreatorPlaylistReview).mockResolvedValue(next);
    setup();
    checks();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload latest review" }),
    );
    await screen.findByText("New name");
    expect(
      screen.getByRole("button", { name: "Mark reviewed" }),
    ).toBeDisabled();
    checks();
    fireEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() =>
      expect(api.reviewCreatorPlaylist).toHaveBeenCalledTimes(2),
    );
    expect(
      vi.mocked(api.reviewCreatorPlaylist).mock.calls[1][1].profileRevision,
    ).toBe(2);
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(screen.queryByText("New name")).not.toBeInTheDocument();
  });
});
