import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
export async function listPublishedScenarios({
  playerId,
  cursor,
}: {
  playerId: string | null;
  cursor: string | null;
}) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_library_previews", {
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 20,
    ...(playerId ? { p_player_id: playerId } : {}),
  });
  if (error) databaseError(error);
  return data;
}
export async function findPublishedScenario(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_library_preview", {
    p_scenario_id: id,
  });
  if (error) databaseError(error);
  return data;
}
