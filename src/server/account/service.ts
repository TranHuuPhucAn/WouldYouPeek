import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireVerifiedUser } from "@/server/auth/guards";
import { databaseError } from "@/server/http";
export async function getAccount() {
  return requireVerifiedUser();
}
export async function enableCreator() {
  await requireVerifiedUser();
  const client = await createServerSupabaseClient();
  const { error } = await client.rpc("enable_creator");
  if (error) databaseError(error);
  return requireVerifiedUser();
}
