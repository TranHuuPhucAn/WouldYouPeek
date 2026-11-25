import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
export async function listPlayerGroups({
  query,
  cursor,
}: {
  query: string;
  cursor: string | null;
}) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_library_players", {
    p_query: query,
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 12,
  });
  if (error) databaseError(error);
  return data;
}
export async function findPlayer(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_library_player", {
    p_player_id: id,
  });
  if (error) databaseError(error);
  return data;
}
