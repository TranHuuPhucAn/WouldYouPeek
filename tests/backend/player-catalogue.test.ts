import { describe, expect, it, beforeEach, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  listPlayerGroups: vi.fn(),
  findPlayer: vi.fn(),
}));
vi.mock("@/server/players/repository", () => mocks);
import { getPlayers, getPlayer } from "@/server/players/service";
import { toPlayerList } from "@/server/players/projections";
import {
  parsePlayerQuery,
  parsePlayerCursor,
} from "@/server/players/validation";
import { parseLibraryFilters } from "@/server/library/validation";
import { TENZ_PLAYER_ID } from "@/contracts/player";
import { snapshot } from "./helpers/session";
const player = { id: TENZ_PLAYER_ID, displayName: "TenZ" };
const preview = () => ({
  ...snapshot().items[0].challenge,
  player,
  editorialOrigin: "curated",
  provenance: "ai",
  publishedAt: null,
});
const cursor = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
const playerCursor = (query = "tenz") =>
  cursor({ v: 1, kind: "players", query, id: TENZ_PLAYER_ID });
const scenarioCursor = (playerId: string | null = TENZ_PLAYER_ID) =>
  cursor({
    v: 1,
    kind: "scenarios",
    playerId,
    at: "2026-11-20T00:00:00Z",
    id: "bind-clove-utility-window",
  });
beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));
describe("player catalogue boundary", () => {
  it("normalizes searches and binds each opaque cursor to its exact normalized filter", () => {
    expect(parsePlayerQuery("  ＴｅＮＺ  ")).toBe("tenz");
    expect(parsePlayerQuery("\t \u0085")).toBe("");
    expect(parsePlayerCursor(playerCursor(), "tenz")).toBe(playerCursor());
    expect(() => parsePlayerCursor(playerCursor(), "other")).toThrow();
    expect(() => parsePlayerCursor(scenarioCursor(), "tenz")).toThrow();
    expect(() => parsePlayerQuery("a".repeat(101))).toThrow();
    expect(() => parsePlayerQuery("A\u0001B")).toThrow();
    expect(
      parseLibraryFilters({
        playerId: TENZ_PLAYER_ID,
        cursor: scenarioCursor(),
      }),
    ).toEqual({ playerId: TENZ_PLAYER_ID, cursor: scenarioCursor() });
    expect(() => parseLibraryFilters({ cursor: scenarioCursor() })).toThrow();
    expect(() => parseLibraryFilters({ playerId: "tenz" })).toThrow();
  });
  it("accepts the old unfiltered creator cursor only on its original route", () => {
    const old = cursor({
      publishedAt: "2026-11-20T00:00:00Z",
      id: TENZ_PLAYER_ID,
    });
    expect(parseLibraryFilters({ cursor: old })).toEqual({
      playerId: null,
      cursor: old,
    });
    expect(() =>
      parseLibraryFilters({ cursor: old, playerId: TENZ_PLAYER_ID }),
    ).toThrow();
    expect(() => parsePlayerCursor(old)).toThrow();
  });
  it.each([
    "",
    "AA",
    "abc=",
    "a".repeat(1025),
    cursor({
      v: 1,
      kind: "players",
      query: "",
      id: TENZ_PLAYER_ID,
      extra: true,
    }),
    cursor({
      v: null,
      kind: "players",
      query: "",
      id: TENZ_PLAYER_ID,
    }),
  ])("rejects malformed cursor %s", (value) => {
    expect(() => parsePlayerCursor(value)).toThrow();
  });
  it("returns canonical safe groups, retaining curated AI origin and unknown publication date", async () => {
    mocks.listPlayerGroups.mockResolvedValue({
      players: [
        {
          player: { ...player, email: "private" },
          scenarioCount: 3,
          scenarios: [preview()],
          private: "hidden",
        },
      ],
      nextCursor: null,
    });
    const result = await getPlayers({ query: " TEnZ " });
    expect(mocks.listPlayerGroups).toHaveBeenCalledWith({
      query: "tenz",
      cursor: null,
    });
    expect(result.players[0]).toMatchObject({
      player,
      scenarioCount: 3,
      scenarios: [
        { editorialOrigin: "curated", provenance: "ai", publishedAt: null },
      ],
    });
    expect(result.players[0]).not.toHaveProperty("private");
    expect(result.players[0].player).not.toHaveProperty("email");
    expect(result.players[0].scenarios[0]).not.toHaveProperty("options");
  });
  it("rejects duplicate, cross-player, empty and inconsistent groups", () => {
    const group = { player, scenarioCount: 3, scenarios: [preview()] };
    for (const players of [
      [group, group],
      [{ ...group, scenarioCount: 0 }],
      [{ ...group, scenarios: [] }],
      [{ ...group, scenarios: [preview(), preview()] }],
      [
        {
          ...group,
          scenarios: [
            {
              ...preview(),
              player: { ...player, displayName: "Someone Else" },
            },
          ],
        },
      ],
    ]) {
      expect(() => toPlayerList({ players, nextCursor: null })).toThrow();
    }
  });
  it("represents absent players as null and rejects mismatched RPC identity", async () => {
    mocks.findPlayer.mockResolvedValue(null);
    expect(await getPlayer(TENZ_PLAYER_ID)).toBeNull();
    mocks.findPlayer.mockResolvedValue(player);
    expect(await getPlayer(TENZ_PLAYER_ID.toUpperCase())).toEqual(player);
    mocks.findPlayer.mockResolvedValue({
      ...player,
      id: "10000000-0000-4000-8000-000000000001",
    });
    await expect(getPlayer(TENZ_PLAYER_ID)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
});
