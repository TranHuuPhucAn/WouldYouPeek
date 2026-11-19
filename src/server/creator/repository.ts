import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
import type {
  CreatorFilter,
  SaveDraftRequest,
  ReviewDraftRequest,
  PublishDraftRequest,
  CreatorCommand,
} from "@/contracts/creator";
import type { Json } from "@/types/database";

export async function listOwnedScenarios(
  status: CreatorFilter,
  cursor: string | null,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_creator_scenarios", {
    p_status: status,
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 20,
  });
  if (error) databaseError(error);
  return data;
}
export async function findOwnedScenario(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_creator_scenario", {
    p_scenario_id: id,
  });
  if (error) databaseError(error);
  return data;
}
export async function createDraft(requestId: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("create_creator_scenario", {
    p_request_id: requestId,
  });
  if (error) databaseError(error);
  return data;
}
export async function saveDraft(id: string, command: SaveDraftRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("save_creator_scenario", {
    p_scenario_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_content: command.content as unknown as Json,
  });
  if (error) databaseError(error);
  return data;
}
export async function getReviewPreview(id: string, revision: number) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_creator_review_preview", {
    p_scenario_id: id,
    p_revision: revision,
  });
  if (error) databaseError(error);
  return data;
}
export async function recordReview(id: string, command: ReviewDraftRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("review_creator_scenario", {
    p_scenario_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_checklist: command.checklist,
  });
  if (error) databaseError(error);
  return data;
}
export async function publishScenario(
  id: string,
  command: PublishDraftRequest,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("publish_creator_scenario", {
    p_scenario_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
    p_review_id: command.reviewId,
  });
  if (error) databaseError(error);
  return data;
}
export async function unpublishScenario(id: string, command: CreatorCommand) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("unpublish_creator_scenario", {
    p_scenario_id: id,
    p_request_id: command.requestId,
    p_expected_revision: command.expectedRevision,
  });
  if (error) databaseError(error);
  return data;
}
