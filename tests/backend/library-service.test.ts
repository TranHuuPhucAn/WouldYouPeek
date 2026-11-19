import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  listPublishedScenarios: vi.fn(),
  findPublishedScenario: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => ({ requireVerifiedUser: mocks.guard }));
vi.mock("@/server/library/repository", () => mocks);
import { getLibrary, getLibraryScenario } from "@/server/library/service";
import { toLibraryPreview } from "@/server/library/projections";
import { ApiError } from "@/server/http";
import { snapshot } from "./helpers/session";
import { creatorScenarioId } from "./helpers/creator";
function preview() {
  return {
    ...snapshot().items[0].challenge,
    id: creatorScenarioId,
    provenance: "creator",
    publishedAt: "2026-11-18T00:00:00Z",
  };
}
beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.guard.mockResolvedValue({ id: "learner" });
});
describe("verified published library", () => {
  it("never exposes analysis/choices/private ownership in previews", async () => {
    const raw = {
      ...preview(),
      analysis: { rationale: "hidden" },
      creatorEmail: "private@example.test",
      review: { private: true },
    };
    const result = toLibraryPreview(raw);
    expect(result.provenance).toBe("creator");
    for (const key of [
      "options",
      "question",
      "decision",
      "analysis",
      "creatorEmail",
      "review",
    ])
      expect(result).not.toHaveProperty(key);
    mocks.findPublishedScenario.mockResolvedValue(raw);
    expect(await getLibraryScenario(creatorScenarioId)).toEqual(result);
  });
  it("requires verification and retains unavailable semantics", async () => {
    mocks.guard.mockRejectedValueOnce(
      new ApiError("EMAIL_NOT_VERIFIED", "Verify."),
    );
    await expect(getLibrary()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
    expect(mocks.listPublishedScenarios).not.toHaveBeenCalled();
    mocks.findPublishedScenario.mockResolvedValue(null);
    await expect(getLibraryScenario(creatorScenarioId)).rejects.toMatchObject({
      code: "SCENARIO_UNAVAILABLE",
    });
  });
  it("validates pagination and returned record identity", async () => {
    mocks.listPublishedScenarios.mockResolvedValue({
      scenarios: [],
      nextCursor: null,
    });
    expect(await getLibrary()).toEqual({ scenarios: [], nextCursor: null });
    await expect(getLibrary("broken-cursor")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    mocks.findPublishedScenario.mockResolvedValue({
      ...preview(),
      id: "foreign",
    });
    await expect(getLibraryScenario(creatorScenarioId)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
});
