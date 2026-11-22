import { describe, it, expect, vi, beforeEach } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc }),
}));
import * as repository from "@/server/training/repository";
import {
  listPreviewRecords,
  findPreviewRecord,
} from "@/server/challenges/repository";
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});
describe("caller-scoped RPC repository", () => {
  it("uses only bound narrow commands without a caller-supplied owner", async () => {
    await repository.startOrResumeSession("r");
    expect(rpc).toHaveBeenLastCalledWith("start_training_session", {
      p_request_id: "r",
    });
    await repository.findActiveSessionSummary();
    expect(rpc).toHaveBeenLastCalledWith("get_active_training_session");
    await repository.findSession("s");
    expect(rpc).toHaveBeenLastCalledWith("get_training_session", {
      p_session_id: "s",
    });
    await repository.submitSessionAnswer("s", "i", {
      optionId: "hold",
      requestId: "r",
      expectedRevision: 2,
    });
    expect(rpc).toHaveBeenLastCalledWith("submit_session_answer", {
      p_session_id: "s",
      p_item_id: "i",
      p_option_id: "hold",
      p_request_id: "r",
      p_expected_revision: 2,
    });
    await repository.advanceSession("s", {
      fromItemId: "i",
      requestId: "r",
      expectedRevision: 3,
    });
    expect(rpc).toHaveBeenLastCalledWith("advance_training_session", {
      p_session_id: "s",
      p_from_item_id: "i",
      p_request_id: "r",
      p_expected_revision: 3,
    });
    await repository.endSession("s", { requestId: "r", expectedRevision: 3 });
    expect(rpc).toHaveBeenLastCalledWith("end_training_session", {
      p_session_id: "s",
      p_request_id: "r",
      p_expected_revision: 3,
    });
  });
  it("bounds history pages and uses preview-only RPCs", async () => {
    await repository.listSessions(null);
    expect(rpc).toHaveBeenLastCalledWith("list_training_sessions", {
      p_limit: 20,
    });
    await repository.listSessions("cursor");
    expect(rpc).toHaveBeenLastCalledWith("list_training_sessions", {
      p_cursor: "cursor",
      p_limit: 20,
    });
    await listPreviewRecords();
    expect(rpc).toHaveBeenLastCalledWith("list_scenario_previews");
    await findPreviewRecord("scenario");
    expect(rpc).toHaveBeenLastCalledWith("get_scenario_preview", {
      p_scenario_id: "scenario",
    });
  });
  it.each([
    "AUTH_REQUIRED",
    "EMAIL_NOT_VERIFIED",
    "SESSION_NOT_FOUND",
    "SESSION_CONFLICT",
    "ANSWER_LOCKED",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_OPTION",
  ])("translates expected SQL denial %s", async (code) => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: code, code: "P0001" },
    });
    await expect(repository.findSession("s")).rejects.toMatchObject({ code });
  });
  it("hides unexpected provider/schema details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "connection secret", code: "connection-error" },
    });
    await expect(repository.findSession("s")).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message: expect.not.stringContaining("connection secret"),
    });
  });
});
