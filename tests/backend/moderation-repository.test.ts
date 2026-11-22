import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc: m.rpc }),
}));
import {
  createReport,
  listReports,
  findReport,
  resolveReport,
  setScenarioVisibility,
} from "@/server/moderation/repository";
import { requestId } from "./helpers/session";
beforeEach(() =>
  m.rpc.mockReset().mockResolvedValue({ data: { safe: true }, error: null }),
);
describe("caller-scoped moderation repository", () => {
  it("sends no service key, actor ID or caller-controlled report version UUID", async () => {
    const target = {
      kind: "publication" as const,
      scenarioId: "bind-clove-utility-window",
      contentVersion: "vod-1",
    };
    await createReport({ requestId, target, category: "spoiler", detail: "" });
    expect(m.rpc).toHaveBeenLastCalledWith("create_scenario_report", {
      p_request_id: requestId,
      p_target: target,
      p_category: "spoiler",
      p_detail: "",
    });
    await listReports({ status: "open", cursor: null, limit: 20 });
    expect(m.rpc).toHaveBeenLastCalledWith("list_operator_reports", {
      p_status: "open",
      p_limit: 20,
    });
    await findReport(requestId);
    expect(m.rpc).toHaveBeenLastCalledWith("get_operator_report", {
      p_report_id: requestId,
    });
    await resolveReport(requestId, {
      requestId,
      expectedRevision: 0,
      resolution: "dismissed",
      operatorNote: "checked",
    });
    expect(m.rpc).toHaveBeenLastCalledWith("resolve_scenario_report", {
      p_report_id: requestId,
      p_request_id: requestId,
      p_expected_revision: 0,
      p_resolution: "dismissed",
      p_operator_note: "checked",
    });
    await setScenarioVisibility(target.scenarioId, {
      requestId,
      expectedRevision: 0,
      hidden: true,
      reason: "review",
    });
    expect(m.rpc).toHaveBeenLastCalledWith("set_operator_scenario_visibility", {
      p_scenario_id: target.scenarioId,
      p_request_id: requestId,
      p_expected_revision: 0,
      p_hidden: true,
      p_reason: "review",
    });
  });
  it.each([
    "REPORT_CONFLICT",
    "REPORT_TARGET_CHANGED",
    "VISIBILITY_CONFLICT",
    "RATE_LIMITED",
    "OPERATOR_REQUIRED",
  ])("preserves safe database error %s", async (code) => {
    m.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: code,
        details: "private internal detail",
      },
    });
    await expect(findReport(requestId)).rejects.toMatchObject({ code });
  });
});
