import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
export async function listPublishedPlaylists(
  query: string,
  playerId: string | null,
  cursor: string | null,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_library_playlists", {
    p_query: query,
    ...(playerId ? { p_player_id: playerId } : {}),
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 20,
  });
  if (error) databaseError(error);
  return data;
}
export async function getPublishedPlaylist(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_library_playlist", {
    p_playlist_id: id,
  });
  if (error) databaseError(error);
  return data;
}
