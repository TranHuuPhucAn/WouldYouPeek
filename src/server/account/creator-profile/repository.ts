import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
import type { SaveCreatorProfileRequest } from "@/contracts/creator-profile";
export async function getCreatorProfile() {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_creator_profile");
  if (error) databaseError(error);
  return data;
}
export async function saveCreatorProfile(command: SaveCreatorProfileRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("save_creator_profile", {
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_display_name: command.displayName,
  });
  if (error) databaseError(error);
  return data;
}
