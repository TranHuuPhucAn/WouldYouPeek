import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listOwnedScenarios: vi.fn(),
  findOwnedScenario: vi.fn(),
  createDraft: vi.fn(),
  saveDraft: vi.fn(),
  getReviewPreview: vi.fn(),
  recordReview: vi.fn(),
  publishScenario: vi.fn(),
  unpublishScenario: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({ requireCreator: mocks.guard }));
vi.mock("@/server/creator/repository", () => mocks);
import * as service from "@/server/creator/service";
import { ApiError } from "@/server/http";
import {
  creatorSnapshot,
  creatorScenarioId,
  creatorReviewId,
  validCreatorContent,
  checkedReview,
} from "./helpers/creator";
import { requestId } from "./helpers/session";
beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.guard.mockResolvedValue({ id: "creator" });
});
describe("creator service use cases", () => {
  it("requires creator authorization before any persistence", async () => {
    mocks.guard.mockRejectedValue(
      new ApiError("CREATOR_REQUIRED", "Enable creator access."),
    );
    for (const operation of [
      () => service.createDraft({ requestId }),
      () => service.findOwnedScenario(creatorScenarioId),
      () => service.saveDraft(creatorScenarioId, {}),
      () => service.getReviewPreview(creatorScenarioId, 1),
      () => service.recordReview(creatorScenarioId, {}),
      () => service.publishScenario(creatorScenarioId, {}),
      () => service.unpublishScenario(creatorScenarioId, {}),
    ])
      await expect(operation()).rejects.toMatchObject({
        code: "CREATOR_REQUIRED",
      });
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.findOwnedScenario).not.toHaveBeenCalled();
  });
  it("validates and projects every mutation response", async () => {
    const result = {
      scenario: creatorSnapshot(),
      replayed: false,
      publishedVersion: null,
    };
    for (const name of [
      "createDraft",
      "saveDraft",
      "recordReview",
      "publishScenario",
      "unpublishScenario",
    ] as const)
      mocks[name].mockResolvedValue(result);
    expect(await service.createDraft({ requestId })).toEqual(result);
    expect(
      await service.saveDraft(creatorScenarioId, {
        requestId,
        expectedRevision: 1,
        content: validCreatorContent(),
      }),
    ).toEqual(result);
    expect(
      await service.recordReview(creatorScenarioId, {
        requestId,
        expectedRevision: 1,
        checklist: checkedReview(),
      }),
    ).toEqual(result);
    expect(
      await service.publishScenario(creatorScenarioId, {
        requestId,
        expectedRevision: 1,
        reviewId: creatorReviewId,
      }),
    ).toEqual(result);
    expect(
      await service.unpublishScenario(creatorScenarioId, {
        requestId,
        expectedRevision: 1,
      }),
    ).toEqual(result);
    mocks.saveDraft.mockResolvedValue({
      ...result,
      scenario: { ...result.scenario, id: creatorReviewId },
    });
    await expect(
      service.saveDraft(creatorScenarioId, {
        requestId,
        expectedRevision: 1,
        content: validCreatorContent(),
      }),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });
  it("preserves missing, conflict and unavailable distinctions", async () => {
    mocks.findOwnedScenario.mockResolvedValue(null);
    await expect(
      service.findOwnedScenario(creatorScenarioId),
    ).rejects.toMatchObject({ code: "SCENARIO_NOT_FOUND" });
    mocks.publishScenario.mockRejectedValue(
      new ApiError("SCENARIO_CONFLICT", "Changed."),
    );
    await expect(
      service.publishScenario(creatorScenarioId, {
        requestId,
        expectedRevision: 1,
        reviewId: creatorReviewId,
      }),
    ).rejects.toMatchObject({ code: "SCENARIO_CONFLICT" });
  });
  it("passes a validated owner filter and cursor to storage", async () => {
    mocks.listOwnedScenarios.mockResolvedValue({
      scenarios: [],
      nextCursor: null,
    });
    expect(await service.listOwnedScenarios(null, "withdrawn")).toEqual({
      scenarios: [],
      nextCursor: null,
    });
    expect(mocks.listOwnedScenarios).toHaveBeenCalledWith("withdrawn", null);
    await expect(
      service.listOwnedScenarios(null, "anything"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
