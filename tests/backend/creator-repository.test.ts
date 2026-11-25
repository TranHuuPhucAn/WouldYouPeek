import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
import * as repository from "@/server/creator/repository";
import * as library from "@/server/library/repository";
import {
  creatorScenarioId,
  creatorReviewId,
  validCreatorContent,
  checkedReview,
} from "./helpers/creator";
import { requestId } from "./helpers/session";
beforeEach(() =>
  mocks.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null }),
);
describe("caller-scoped creator and library RPC adapters", () => {
  it("passes actor-free commands to the expected RPCs", async () => {
    await repository.createDraft(requestId);
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_creator_scenario", {
      p_request_id: requestId,
    });
    await repository.findOwnedScenario(creatorScenarioId);
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_creator_scenario", {
      p_scenario_id: creatorScenarioId,
    });
    await repository.listOwnedScenarios("withdrawn", null);
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_creator_scenarios", {
      p_status: "withdrawn",
      p_limit: 20,
    });
    await repository.saveDraft(creatorScenarioId, {
      requestId,
      expectedRevision: 1,
      content: validCreatorContent(),
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "save_creator_scenario",
      expect.objectContaining({
        p_expected_revision: 1,
        p_content: validCreatorContent(),
      }),
    );
    await repository.getReviewPreview(creatorScenarioId, 2);
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_creator_review_preview", {
      p_scenario_id: creatorScenarioId,
      p_revision: 2,
    });
    await repository.recordReview(creatorScenarioId, {
      requestId,
      expectedRevision: 2,
      checklist: checkedReview(),
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "review_creator_scenario",
      expect.objectContaining({ p_checklist: checkedReview() }),
    );
    await repository.publishScenario(creatorScenarioId, {
      requestId,
      expectedRevision: 3,
      reviewId: creatorReviewId,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "publish_creator_scenario",
      expect.objectContaining({ p_review_id: creatorReviewId }),
    );
    await repository.unpublishScenario(creatorScenarioId, {
      requestId,
      expectedRevision: 4,
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "unpublish_creator_scenario",
      expect.objectContaining({ p_expected_revision: 4 }),
    );
    await library.listPublishedScenarios({ playerId: null, cursor: null });
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_library_previews", {
      p_limit: 20,
    });
    await library.findPublishedScenario(creatorScenarioId);
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_library_preview", {
      p_scenario_id: creatorScenarioId,
    });
  });
  it("preserves known conflicts and suppresses provider diagnostics", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "SCENARIO_CONFLICT" },
    });
    await expect(repository.createDraft(requestId)).rejects.toMatchObject({
      code: "SCENARIO_CONFLICT",
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "database password: secret" },
    });
    await expect(
      library.listPublishedScenarios({ playerId: null, cursor: null }),
    ).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
});
