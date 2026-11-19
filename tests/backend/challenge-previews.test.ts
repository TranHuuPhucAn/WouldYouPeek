import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  listPreviewRecords: vi.fn(),
  findPreviewRecord: vi.fn(),
}));
vi.mock("@/server/challenges/repository", () => mocks);
import {
  listChallengePreviews,
  getChallengePreview,
} from "@/server/challenges/service";
import { getChallenge, listChallenges } from "../fixtures/authored-challenges";
beforeEach(() => {
  mocks.listPreviewRecords.mockReset();
  mocks.findPreviewRecord.mockReset();
});
describe("database public previews", () => {
  it("whitelists setup-only previews even if database unexpectedly returns answer fields", async () => {
    mocks.listPreviewRecords.mockResolvedValue(
      listChallenges().map((s) => ({
        ...getChallenge(s.id),
        takeaway: "private",
      })),
    );
    const previews = await listChallengePreviews();
    expect(previews).toHaveLength(3);
    for (const preview of previews) {
      expect(preview).not.toHaveProperty("question");
      expect(preview).not.toHaveProperty("options");
      expect(preview).not.toHaveProperty("decision");
      expect(preview).not.toHaveProperty("takeaway");
    }
  });
  it("returns missing scenario as404", async () => {
    mocks.findPreviewRecord.mockResolvedValue(null);
    await expect(getChallengePreview("missing")).rejects.toMatchObject({
      code: "CHALLENGE_NOT_FOUND",
    });
  });
  it("does not replace storage outage with fixtures", async () => {
    mocks.listPreviewRecords.mockRejectedValue(new Error("unavailable"));
    await expect(listChallengePreviews()).rejects.toThrow("unavailable");
  });
});
