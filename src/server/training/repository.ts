import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
import type {
  AnswerSessionRequest,
  AdvanceSessionRequest,
} from "@/contracts/session";
export async function startOrResumeSession(requestId: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("start_training_session", {
    p_request_id: requestId,
  });
  if (error) databaseError(error);
  return data;
}
export async function findSession(sessionId: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_training_session", {
    p_session_id: sessionId,
  });
  if (error) databaseError(error);
  return data;
}
export async function listSessions(cursor: string | null) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_training_sessions", {
    ...(cursor ? { p_cursor: cursor } : {}),
    p_limit: 20,
  });
  if (error) databaseError(error);
  return data;
}
export async function submitSessionAnswer(
  sessionId: string,
  itemId: string,
  input: AnswerSessionRequest,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("submit_session_answer", {
    p_session_id: sessionId,
    p_item_id: itemId,
    p_option_id: input.optionId,
    p_request_id: input.requestId,
    p_expected_revision: input.expectedRevision,
  });
  if (error) databaseError(error);
  return data;
}
export async function advanceSession(
  sessionId: string,
  input: AdvanceSessionRequest,
) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("advance_training_session", {
    p_session_id: sessionId,
    p_from_item_id: input.fromItemId,
    p_request_id: input.requestId,
    p_expected_revision: input.expectedRevision,
  });
  if (error) databaseError(error);
  return data;
}
