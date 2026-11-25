import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
import * as creator from "@/server/creator-playlists/service";
import * as profile from "@/server/account/creator-profile/service";
import * as library from "@/server/playlists/service";
import { ApiError } from "@/server/http";
import { playlistId, playlistSnapshot } from "./helpers/playlist";
const requestId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  mocks.guard.mockReset().mockResolvedValue({});
  mocks.rpc.mockReset();
});
describe("playlist use cases", () => {
  it("requires creator authorization before validation or persistence", async () => {
    mocks.guard.mockRejectedValue(
      new ApiError("CREATOR_REQUIRED", "Enable access."),
    );
    for (const operation of [
      () => creator.listOwnedPlaylists(),
      () => creator.findOwnedPlaylist(playlistId),
      () => creator.listSelectableScenarios(),
      () => creator.createPlaylist({ requestId }),
      () => creator.savePlaylist(playlistId, {}),
      () => creator.getPlaylistReviewPreview(playlistId, 0),
      () => creator.recordPlaylistReview(playlistId, {}),
      () => creator.publishPlaylist(playlistId, {}),
      () => creator.unpublishPlaylist(playlistId, {}),
      () => profile.getCreatorProfile(),
      () => profile.saveCreatorProfile({}),
    ])
      await expect(operation()).rejects.toMatchObject({
        code: "CREATOR_REQUIRED",
      });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates mutations and checks returned resource identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        playlist: playlistSnapshot(),
        replayed: false,
        publishedVersion: null,
      },
      error: null,
    });
    expect((await creator.createPlaylist({ requestId })).playlist.id).toBe(
      playlistId,
    );
    await creator.savePlaylist(playlistId, {
      requestId,
      expectedRevision: 0,
      content: { title: " A  B ", description: "", items: [] },
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "save_creator_playlist",
      expect.objectContaining({
        p_content: { title: "A B", description: "", items: [] },
      }),
    );
    await expect(
      creator.savePlaylist(playlistId, {
        requestId,
        expectedRevision: 0,
        content: { title: "A", description: "", items: [] },
        ownerId: playlistId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      creator.unpublishPlaylist(requestId, { requestId, expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });
  it("public listing remains unauthenticated and preserves failure states", async () => {
    mocks.rpc.mockResolvedValue({
      data: { playlists: [], nextCursor: null },
      error: null,
    });
    expect(await library.listPublishedPlaylists(" TENZ ")).toEqual({
      playlists: [],
      nextCursor: null,
    });
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_library_playlists", {
      p_query: "tenz",
      p_limit: 20,
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "hidden provider failure" },
    });
    await expect(library.listPublishedPlaylists()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
});
