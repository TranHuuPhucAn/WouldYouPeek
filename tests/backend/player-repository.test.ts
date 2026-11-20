import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc }),
}));
import { listPlayerGroups, findPlayer } from "@/server/players/repository";
import {
  listPublishedScenarios,
  findPublishedScenario,
} from "@/server/library/repository";
import { TENZ_PLAYER_ID } from "@/contracts/player";
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});
describe("guest-safe catalogue repositories", () => {
  it("uses bounded RPCs with no caller-supplied ownership", async () => {
    await listPlayerGroups({ query: "tenz", cursor: null });
    expect(rpc).toHaveBeenLastCalledWith("list_library_players", {
      p_query: "tenz",
      p_limit: 12,
    });
    await findPlayer(TENZ_PLAYER_ID);
    expect(rpc).toHaveBeenLastCalledWith("get_library_player", {
      p_player_id: TENZ_PLAYER_ID,
    });
    await listPublishedScenarios({ playerId: TENZ_PLAYER_ID, cursor: "next" });
    expect(rpc).toHaveBeenLastCalledWith("list_library_previews", {
      p_player_id: TENZ_PLAYER_ID,
      p_cursor: "next",
      p_limit: 20,
    });
    await findPublishedScenario("bind-clove-utility-window");
    expect(rpc).toHaveBeenLastCalledWith("get_library_preview", {
      p_scenario_id: "bind-clove-utility-window",
    });
  });
  it("sanitizes unexpected provider errors", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "db", message: "private schema secret" },
    });
    await expect(
      listPlayerGroups({ query: "", cursor: null }),
    ).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message: expect.not.stringContaining("secret"),
    });
  });
});
