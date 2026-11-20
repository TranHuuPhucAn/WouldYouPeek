import { beforeEach, describe, expect, it, vi } from "vitest";
const getPlayers = vi.hoisted(() => vi.fn());
vi.mock("@/server/players/service", () => ({ getPlayers }));
import { GET } from "@/app/api/library/players/route";
import { ApiError } from "@/server/http";
beforeEach(() => {
  getPlayers.mockReset().mockResolvedValue({ players: [], nextCursor: null });
});
describe("public player route", () => {
  it("forwards only supported search filters and prevents shared caching", async () => {
    const response = await GET(
      new Request("http://localhost/api/library/players?query=TenZ&cursor=abc"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(getPlayers).toHaveBeenCalledWith({ query: "TenZ", cursor: "abc" });
    expect(await response.json()).toEqual({ players: [], nextCursor: null });
  });
  it.each(["query=a&query=b", "owner=hidden", "playerId=hidden"])(
    "rejects unsupported or repeated query %s",
    async (query) => {
      expect(
        (
          await GET(
            new Request(`http://localhost/api/library/players?${query}`),
          )
        ).status,
      ).toBe(400);
      expect(getPlayers).not.toHaveBeenCalled();
    },
  );
  it("keeps failures as failures instead of disguising them as an empty library", async () => {
    getPlayers.mockRejectedValue(
      new ApiError("STORAGE_UNAVAILABLE", "Try again."),
    );
    expect(
      (await GET(new Request("http://localhost/api/library/players"))).status,
    ).toBe(503);
  });
});
