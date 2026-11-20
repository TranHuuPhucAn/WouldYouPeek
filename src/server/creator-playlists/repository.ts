import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
import type {
  PlaylistFilter,
  SavePlaylistRequest,
  ReviewPlaylistRequest,
  PublishPlaylistRequest,
  PlaylistCommand,
} from "@/contracts/playlist";
import type { Json } from "@/types/database";
export async function listOwnedPlaylists(
  status: PlaylistFilter,
  cursor: string | null,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_creator_playlists", {
    p_status: status,
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 20,
  });
  if (error) databaseError(error);
  return data;
}
export async function findOwnedPlaylist(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_creator_playlist", {
    p_playlist_id: id,
  });
  if (error) databaseError(error);
  return data;
}
export async function listSelectableScenarios(
  query: string,
  cursor: string | null,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_creator_playlist_scenarios", {
    p_query: query,
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 20,
  });
  if (error) databaseError(error);
  return data;
}
export async function createPlaylist(requestId: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("create_creator_playlist", {
    p_request_id: requestId,
  });
  if (error) databaseError(error);
  return data;
}
export async function savePlaylist(id: string, command: SavePlaylistRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("save_creator_playlist", {
    p_playlist_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_content: command.content as unknown as Json,
  });
  if (error) databaseError(error);
  return data;
}
export async function getPlaylistReviewPreview(id: string, revision: number) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc(
    "get_creator_playlist_review_preview",
    { p_playlist_id: id, p_revision: revision },
  );
  if (error) databaseError(error);
  return data;
}
export async function recordPlaylistReview(
  id: string,
  command: ReviewPlaylistRequest,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("review_creator_playlist", {
    p_playlist_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_profile_revision: command.profileRevision,
    p_checklist: command.checklist,
  });
  if (error) databaseError(error);
  return data;
}
export async function publishPlaylist(
  id: string,
  command: PublishPlaylistRequest,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("publish_creator_playlist", {
    p_playlist_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_review_id: command.reviewId,
  });
  if (error) databaseError(error);
  return data;
}
export async function unpublishPlaylist(id: string, command: PlaylistCommand) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("unpublish_creator_playlist", {
    p_playlist_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
  });
  if (error) databaseError(error);
  return data;
}
