import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  listChallengePreviews: vi.fn(),
  getChallengePreview: vi.fn(),
  guard: vi.fn(),
}));
vi.mock("@/server/challenges/service", () => mocks);
vi.mock("@/server/auth/guards", () => ({ requireVerifiedUser: mocks.guard }));
import { GET as list } from "@/app/api/challenges/route";
import { GET as detail } from "@/app/api/challenges/[id]/route";
import { POST as retiredAnswer } from "@/app/api/challenges/[id]/answer/route";
import { ApiError } from "@/server/http";
beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));
describe("public challenge route boundaries", () => {
  it("returns only database previews", async () => {
    mocks.listChallengePreviews.mockResolvedValue([
      { id: "demo", setup: { kind: "youtube" } },
    ]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      challenges: [{ id: "demo", setup: { kind: "youtube" } }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("awaits route params", async () => {
    mocks.getChallengePreview.mockResolvedValue({ id: "scenario" });
    const response = await detail(
      new Request("http://localhost/api/challenges/scenario"),
      { params: Promise.resolve({ id: "scenario" }) },
    );
    expect(await response.json()).toEqual({ id: "scenario" });
    expect(mocks.getChallengePreview).toHaveBeenCalledWith("scenario");
  });
  it.each([
    ["CHALLENGE_NOT_FOUND", 404],
    ["STORAGE_UNAVAILABLE", 503],
  ] as const)("maps %s", async (code, status) => {
    mocks.getChallengePreview.mockRejectedValue(
      new ApiError(code, "Unavailable"),
    );
    expect(
      (
        await detail(new Request("http://localhost/api"), {
          params: Promise.resolve({ id: "missing" }),
        })
      ).status,
    ).toBe(status);
  });
  it("retires guest stateless answer with401", async () => {
    mocks.guard.mockRejectedValue(new ApiError("AUTH_REQUIRED", "Sign in"));
    const response = await retiredAnswer();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });
  it("retires signed-in stateless answer with409", async () => {
    mocks.guard.mockResolvedValue({ id: "u" });
    const response = await retiredAnswer();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SESSION_REQUIRED" },
    });
  });
});
