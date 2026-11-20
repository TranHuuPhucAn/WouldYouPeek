import { describe, it, expect, vi, beforeEach } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc }),
}));
import * as creator from "@/server/creator-playlists/repository";
import * as profile from "@/server/account/creator-profile/repository";
import * as library from "@/server/playlists/repository";
import { startOrResumeSession } from "@/server/training/repository";
import {
  PLAYLIST_REVIEW_CHECKLIST_KEYS,
  type PlaylistReviewChecklist,
} from "@/contracts/playlist";
beforeEach(() => rpc.mockReset().mockResolvedValue({ data: {}, error: null }));
describe("narrow caller-scoped playlist persistence", () => {
  it("binds revision, content and seen credit without taking caller ownership", async () => {
    await profile.getCreatorProfile();
    expect(rpc).toHaveBeenLastCalledWith("get_creator_profile");
    await profile.saveCreatorProfile({
      requestId: "request",
      expectedRevision: 1,
      displayName: "Coach",
    });
    expect(rpc).toHaveBeenLastCalledWith("save_creator_profile", {
      p_request_id: "request",
      p_expected_revision: 1,
      p_display_name: "Coach",
    });
    await creator.createPlaylist("request");
    expect(rpc).toHaveBeenLastCalledWith("create_creator_playlist", {
      p_request_id: "request",
    });
    const content = { title: "Test", description: "", items: [] };
    await creator.savePlaylist("playlist", {
      requestId: "request",
      expectedRevision: 2,
      content,
    });
    expect(rpc).toHaveBeenLastCalledWith("save_creator_playlist", {
      p_playlist_id: "playlist",
      p_request_id: "request",
      p_expected_revision: 2,
      p_content: content,
    });
    const checklist = Object.fromEntries(
      PLAYLIST_REVIEW_CHECKLIST_KEYS.map((k) => [k, true]),
    ) as PlaylistReviewChecklist;
    await creator.recordPlaylistReview("playlist", {
      requestId: "request",
      expectedRevision: 3,
      profileRevision: 7,
      checklist,
    });
    expect(rpc).toHaveBeenLastCalledWith("review_creator_playlist", {
      p_playlist_id: "playlist",
      p_request_id: "request",
      p_expected_revision: 3,
      p_profile_revision: 7,
      p_checklist: checklist,
    });
    await creator.publishPlaylist("playlist", {
      requestId: "request",
      expectedRevision: 4,
      reviewId: "review",
    });
    expect(rpc).toHaveBeenLastCalledWith("publish_creator_playlist", {
      p_playlist_id: "playlist",
      p_request_id: "request",
      p_expected_revision: 4,
      p_review_id: "review",
    });
    await creator.unpublishPlaylist("playlist", {
      requestId: "request",
      expectedRevision: 5,
    });
    expect(rpc).toHaveBeenLastCalledWith("unpublish_creator_playlist", {
      p_playlist_id: "playlist",
      p_request_id: "request",
      p_expected_revision: 5,
    });
  });
  it("bounds listings and sends the exact public start pin", async () => {
    await library.listPublishedPlaylists("tenz", "player", "cursor");
    expect(rpc).toHaveBeenLastCalledWith("list_library_playlists", {
      p_query: "tenz",
      p_player_id: "player",
      p_cursor: "cursor",
      p_limit: 20,
    });
    await creator.listOwnedPlaylists("all", null);
    expect(rpc).toHaveBeenLastCalledWith("list_creator_playlists", {
      p_status: "all",
      p_limit: 20,
    });
    await creator.listSelectableScenarios("tenz", null);
    expect(rpc).toHaveBeenLastCalledWith("list_creator_playlist_scenarios", {
      p_query: "tenz",
      p_limit: 20,
    });
    await creator.getPlaylistReviewPreview("playlist", 4);
    expect(rpc).toHaveBeenLastCalledWith(
      "get_creator_playlist_review_preview",
      { p_playlist_id: "playlist", p_revision: 4 },
    );
    await startOrResumeSession(
      "request",
      { kind: "playlist", playlistId: "playlist" },
      "publication",
    );
    expect(rpc).toHaveBeenLastCalledWith("start_playlist_training_session", {
      p_request_id: "request",
      p_playlist_id: "playlist",
      p_expected_publication_version: "publication",
    });
  });
  it.each([
    "PLAYLIST_NOT_FOUND",
    "PLAYLIST_UNAVAILABLE",
    "PLAYLIST_CONFLICT",
    "PLAYLIST_CHANGED",
    "CREATOR_PROFILE_CONFLICT",
  ])("maps safe SQL conflict %s", async (code) => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: code, details: '{"secret":"hidden"}' },
    });
    await expect(creator.findOwnedPlaylist("playlist")).rejects.toMatchObject({
      code,
      details: undefined,
    });
  });
});
