import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  getLibraryScenario: vi.fn(),
}));
vi.mock("@/server/library/service", () => mocks);
import { GET as list } from "@/app/api/library/scenarios/route";
import { GET as detail } from "@/app/api/library/scenarios/[id]/route";
import { ApiError } from "@/server/http";
import { creatorScenarioId } from "./helpers/creator";
describe("library route projections", () => {
  it("returns private no-store results and only accepts supported query parameters", async () => {
    mocks.getLibrary.mockResolvedValue({ scenarios: [], nextCursor: null });
    const response = await list(
      new Request("http://localhost/api/library/scenarios"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(
      (
        await list(
          new Request("http://localhost/api/library/scenarios?owner=other"),
        )
      ).status,
    ).toBe(400);
  });
  it("preserves auth and unavailable statuses", async () => {
    mocks.getLibrary.mockRejectedValue(
      new ApiError("AUTH_REQUIRED", "Sign in."),
    );
    expect(
      (await list(new Request("http://localhost/api/library/scenarios")))
        .status,
    ).toBe(401);
    mocks.getLibraryScenario.mockRejectedValue(
      new ApiError("SCENARIO_UNAVAILABLE", "Unavailable."),
    );
    expect(
      (
        await detail(new Request("http://localhost"), {
          params: Promise.resolve({ id: creatorScenarioId }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.getLibraryScenario).toHaveBeenCalledWith(creatorScenarioId);
  });
});
