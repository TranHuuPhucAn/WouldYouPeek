import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
import type {
  SubmitReportRequest,
  ResolveReportRequest,
  VisibilityRequest,
} from "@/contracts/moderation";
import type { OperatorReportQuery } from "./validation";
export async function createReport(c: SubmitReportRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("create_scenario_report", {
    p_request_id: c.requestId,
    p_target: c.target,
    p_category: c.category,
    p_detail: c.detail,
  });
  if (error) databaseError(error);
  return data;
}
export async function listReports(q: OperatorReportQuery) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("list_operator_reports", {
    p_status: q.status,
    ...(q.cursor === null ? {} : { p_cursor: q.cursor }),
    p_limit: q.limit,
  });
  if (error) databaseError(error);
  return data;
}
export async function findReport(id: string) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("get_operator_report", {
    p_report_id: id,
  });
  if (error) databaseError(error);
  return data;
}
export async function resolveReport(id: string, c: ResolveReportRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("resolve_scenario_report", {
    p_report_id: id,
    p_request_id: c.requestId,
    p_expected_revision: c.expectedRevision,
    p_resolution: c.resolution,
    p_operator_note: c.operatorNote,
  });
  if (error) databaseError(error);
  return data;
}
export async function setScenarioVisibility(id: string, c: VisibilityRequest) {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc("set_operator_scenario_visibility", {
    p_scenario_id: id,
    p_request_id: c.requestId,
    p_expected_revision: c.expectedRevision,
    p_hidden: c.hidden,
    p_reason: c.reason,
  });
  if (error) databaseError(error);
  return data;
}
