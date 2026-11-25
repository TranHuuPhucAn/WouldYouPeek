import { render, screen } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import DetailPage from "@/app/library/playlists/[playlistId]/page";
import LibraryPage from "@/app/library/playlists/page";
import PlayerPage from "@/app/library/players/[playerId]/page";
import CreatorPage from "@/app/creator/playlists/page";
import EditorPage from "@/app/creator/playlists/[id]/page";
import ReviewPage from "@/app/creator/playlists/[id]/review/page";
import * as publicService from "@/server/playlists/service";
import * as creatorService from "@/server/creator-playlists/service";
import { getCreatorProfile } from "@/server/account/creator-profile/service";
import { getCurrentAccount, requireVerifiedUser } from "@/server/auth/guards";
import { getActiveSessionSummary } from "@/server/training/service";
import { getPlayer } from "@/server/players/service";
import { getLibrary } from "@/server/library/service";
import { ApiError } from "@/server/http";
import {
  detail,
  preview,
  candidate,
  playlistSnapshot,
  reviewPreview,
  playlistId,
  publicationId,
} from "./playlist-fixtures";
import { viewer } from "./session-fixtures";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/playlists/service", () => ({
  listPublishedPlaylists: vi.fn(),
  getPublishedPlaylist: vi.fn(),
}));
vi.mock("@/server/creator-playlists/service", () => ({
  listOwnedPlaylists: vi.fn(),
  findOwnedPlaylist: vi.fn(),
  listSelectableScenarios: vi.fn(),
  getPlaylistReviewPreview: vi.fn(),
}));
vi.mock("@/server/account/creator-profile/service", () => ({
  getCreatorProfile: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({
  getCurrentAccount: vi.fn(),
  requireVerifiedUser: vi.fn(),
}));
vi.mock("@/server/training/service", () => ({
  getActiveSessionSummary: vi.fn(),
}));
vi.mock("@/server/players/service", () => ({ getPlayer: vi.fn() }));
vi.mock("@/server/library/service", () => ({ getLibrary: vi.fn() }));
vi.mock("@/components/creator/PlaylistDashboard", () => ({
  PlaylistDashboard: () => <p>Owner dashboard</p>,
}));
vi.mock("@/components/creator/PlaylistEditor", () => ({
  PlaylistEditor: () => <p>Owner editor</p>,
}));
vi.mock("@/components/creator/PlaylistReview", () => ({
  PlaylistReview: ({
    initialPreview,
    initialError,
  }: {
    initialPreview: unknown;
    initialError?: string;
  }) => (
    <p>
      {initialError ??
        (initialPreview ? "Saved metadata review" : "Readiness blockers")}
    </p>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAccount).mockResolvedValue(null);
  vi.mocked(requireVerifiedUser).mockResolvedValue({
    ...viewer,
    role: "creator",
    capabilities: ["learn", "create"],
  });
  vi.mocked(publicService.getPublishedPlaylist).mockResolvedValue(detail());
  vi.mocked(publicService.listPublishedPlaylists).mockResolvedValue({
    playlists: [preview()],
    nextCursor: null,
  });
  vi.mocked(creatorService.listOwnedPlaylists).mockResolvedValue({
    playlists: [],
    nextCursor: null,
  });
  vi.mocked(creatorService.findOwnedPlaylist).mockResolvedValue(
    playlistSnapshot(),
  );
  vi.mocked(creatorService.listSelectableScenarios).mockResolvedValue({
    scenarios: [candidate()],
    nextCursor: null,
  });
  vi.mocked(creatorService.getPlaylistReviewPreview).mockResolvedValue(
    reviewPreview(),
  );
  vi.mocked(getCreatorProfile).mockResolvedValue({
    displayName: "Coach",
    revision: 1,
  });
  vi.mocked(getPlayer).mockResolvedValue(candidate().player);
  vi.mocked(getActiveSessionSummary).mockResolvedValue(null);
});
describe("playlist server pages", () => {
  it("provides guests metadata-only detail and exact sign-in return without a video player or answer", async () => {
    const rendered = render(
      await DetailPage({ params: Promise.resolve({ playlistId }) }),
    );
    expect(screen.getByRole("heading", { name: detail().title })).toBeVisible();
    expect(screen.getByText("aspas", { selector: "a" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Sign in to play/ }),
    ).toHaveAttribute(
      "href",
      `/sign-in?returnTo=${encodeURIComponent(`/library/playlists/${playlistId}`)}`,
    );
    expect(rendered.container.querySelector("iframe,video")).toBeNull();
    expect(rendered.container).not.toHaveTextContent(publicationId);
    expect(getActiveSessionSummary).not.toHaveBeenCalled();
  });
  it("handles unavailable detail generically while preserving history navigation", async () => {
    vi.mocked(publicService.getPublishedPlaylist).mockRejectedValue(
      new ApiError("PLAYLIST_UNAVAILABLE", "Unavailable"),
    );
    render(await DetailPage({ params: Promise.resolve({ playlistId }) }));
    expect(
      screen.getByRole("heading", { name: "This playlist is unavailable." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View saved sessions" }),
    ).toHaveAttribute("href", "/history");
  });
  it("filters exact player without trimming mixed playlist contents and avoids guest private reads", async () => {
    render(
      await PlayerPage({
        params: Promise.resolve({ playerId: candidate().player.id }),
        searchParams: Promise.resolve({ view: "playlists" }),
      }),
    );
    expect(publicService.listPublishedPlaylists).toHaveBeenCalledWith(
      "",
      candidate().player.id,
    );
    expect(getLibrary).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "aspas" })).toBeVisible();
    expect(getActiveSessionSummary).not.toHaveBeenCalled();
  });
  it("keeps public results when saved-session lookup fails and real catalogue failure is visible", async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue(viewer);
    vi.mocked(getActiveSessionSummary).mockRejectedValue(new Error("offline"));
    const view = render(
      await LibraryPage({ searchParams: Promise.resolve({ query: "TenZ" }) }),
    );
    expect(screen.getByRole("link", { name: detail().title })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "saved session couldn’t load",
    );
    view.unmount();
    vi.mocked(publicService.listPublishedPlaylists).mockRejectedValue(
      new Error("offline"),
    );
    render(await LibraryPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Playlists couldn’t load",
    );
  });
  it("guards every owner route before querying private data and loads saved revision for creators", async () => {
    vi.mocked(requireVerifiedUser).mockResolvedValue(viewer);
    await expect(CreatorPage()).rejects.toThrow("REDIRECT:/account");
    await expect(
      EditorPage({ params: Promise.resolve({ id: playlistId }) }),
    ).rejects.toThrow("REDIRECT:/account");
    await expect(
      ReviewPage({ params: Promise.resolve({ id: playlistId }) }),
    ).rejects.toThrow("REDIRECT:/account");
    expect(creatorService.findOwnedPlaylist).not.toHaveBeenCalled();
    vi.mocked(requireVerifiedUser).mockResolvedValue({
      ...viewer,
      role: "creator",
      capabilities: ["learn", "create"],
    });
    render(await ReviewPage({ params: Promise.resolve({ id: playlistId }) }));
    expect(screen.getByText("Saved metadata review")).toBeVisible();
    expect(creatorService.getPlaylistReviewPreview).toHaveBeenCalledWith(
      playlistId,
      1,
    );
  });
});
