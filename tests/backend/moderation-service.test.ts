import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http";
import { requestId } from "./helpers/session";
const m = vi.hoisted(() => ({
  requireVerifiedUser: vi.fn(),
  requireOperator: vi.fn(),
  createReport: vi.fn(),
  listReports: vi.fn(),
  findReport: vi.fn(),
  resolveReport: vi.fn(),
  setScenarioVisibility: vi.fn(),
}));
vi.mock("@/server/auth/guards", () => m);
vi.mock("@/server/moderation/repository", () => m);
import {
  submitReport,
  getOperatorReports,
  getOperatorReport,
  resolveOperatorReport,
  changeScenarioVisibility,
} from "@/server/moderation/service";
beforeEach(() => Object.values(m).forEach((f) => f.mockReset()));
describe("moderation service authorization", () => {
  it("requires verified learner identity before report parsing/persistence", async () => {
    m.requireVerifiedUser.mockRejectedValue(
      new ApiError("EMAIL_NOT_VERIFIED", "Verify first."),
    );
    await expect(submitReport({})).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
    expect(m.createReport).not.toHaveBeenCalled();
  });
  it("checks current operator access on every privileged operation, even retries", async () => {
    m.requireOperator.mockRejectedValue(
      new ApiError("OPERATOR_REQUIRED", "No access."),
    );
    for (const call of [
      () => getOperatorReports(),
      () => getOperatorReport(requestId),
      () => resolveOperatorReport(requestId, {}),
      () => changeScenarioVisibility("bind-clove-utility-window", {}),
    ])
      await expect(call()).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
    expect(m.requireOperator).toHaveBeenCalledTimes(4);
    for (const f of [
      m.listReports,
      m.findReport,
      m.resolveReport,
      m.setScenarioVisibility,
    ])
      expect(f).not.toHaveBeenCalled();
  });
  it("returns only receipt fields to learners", async () => {
    m.createReport.mockResolvedValue({
      report: {
        id: requestId,
        status: "open",
        createdAt: "2026-11-22T00:00:00Z",
        operatorNote: "private",
      },
      duplicate: false,
      replayed: false,
    });
    const result = await submitReport({
      requestId,
      target: {
        kind: "publication",
        scenarioId: "bind-clove-utility-window",
        contentVersion: "vod-1",
      },
      category: "broken_video",
      detail: "",
    });
    expect(result.report).not.toHaveProperty("operatorNote");
    expect(m.requireOperator).not.toHaveBeenCalled();
  });
});
