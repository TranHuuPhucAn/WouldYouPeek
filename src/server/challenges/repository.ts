import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
export async function listPreviewRecords() {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_scenario_previews");
  if (error) databaseError(error);
  return data;
}
export async function findPreviewRecord(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_scenario_preview", {
    p_scenario_id: id,
  });
  if (error) databaseError(error);
  return data;
}
