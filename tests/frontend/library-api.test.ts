import { describe, expect, it, vi } from "vitest";
import {
  getLibraryScenario,
  listLibraryPlayers,
  listLibraryScenarios,
  parseLibraryEntry,
  parsePlayerListResponse,
} from "@/lib/client/library-api";
import {
  parseSessionSnapshot,
  parseSessionTarget,
  createOrResumeSession,
  getSession,
} from "@/lib/client/session-api";
import { parsePlayerSummary } from "@/lib/client/player-validation";
import {
  normalizePlayerDisplayName,
  PLAYER_DISPLAY_MAX_CODE_POINTS,
} from "@/lib/players/identity";
import { libraryEntry, selectedSnapshot, commandId } from "./creator-fixtures";

const slug = "tenz-bind-clove-utility-before-contact";
function group() {
  const entry = libraryEntry();
  return { player: entry.player, scenarioCount: 4, scenarios: [entry] };
}

describe("public player catalogue boundary", () => {
  it.each(["a".repeat(300), "🎮".repeat(300), "ﷺ".repeat(300)])(
    "accepts safe canonical metadata expanded from valid long authoring names %#",
    (raw) => {
      const entry = libraryEntry();
      entry.player.displayName = normalizePlayerDisplayName(raw);
      entry.source!.player = raw;
      expect(parseLibraryEntry(entry)).toEqual(entry);
      expect(parsePlayerSummary(entry.player)).toEqual(entry.player);
    },
  );
  it("bounds normalized display payloads independently of the raw authoring field", () => {
    const player = {
      ...libraryEntry().player,
      displayName: "x".repeat(PLAYER_DISPLAY_MAX_CODE_POINTS + 1),
    };
    expect(() => parsePlayerSummary(player)).toThrow();
  });
  it("accepts curated slugs with honest provenance and no invented publication date", () => {
    const entry = {
      ...libraryEntry(),
      id: slug,
      editorialOrigin: "curated",
      provenance: "ai",
      publishedAt: null,
    };
    expect(parseLibraryEntry(entry)).toEqual(entry);
  });
  it.each([
    (value: ReturnType<typeof group>) => ({ ...value, scenarioCount: 0 }),
    (value: ReturnType<typeof group>) => ({
      ...value,
      scenarios: [...value.scenarios, ...value.scenarios],
    }),
    (value: ReturnType<typeof group>) => ({ ...value, ownerEmail: "private" }),
    (value: ReturnType<typeof group>) => ({
      ...value,
      player: { ...value.player, private: "secret" },
    }),
    (value: ReturnType<typeof group>) => ({
      ...value,
      player: { ...value.player, id: commandId },
    }),
    (value: ReturnType<typeof group>) => ({
      ...value,
      scenarios: [{ ...value.scenarios[0], observedAction: "secret" }],
    }),
  ])("rejects corrupt, mismatched or revealing player groups %#", (change) => {
    expect(() =>
      parsePlayerListResponse({ players: [change(group())], nextCursor: null }),
    ).toThrow();
  });
  it("rejects duplicate players and pagination that exceeds the public group limit", () => {
    expect(() =>
      parsePlayerListResponse({
        players: [group(), group()],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parsePlayerListResponse({
        players: Array.from({ length: 13 }, group),
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parsePlayerListResponse({ players: [group()], nextCursor: "" }),
    ).toThrow();
  });
  it("encodes player filters and cursor without making a protected mutation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ players: [group()], nextCursor: null }),
      )
      .mockResolvedValueOnce(
        Response.json({ scenarios: [libraryEntry()], nextCursor: null }),
      )
      .mockResolvedValueOnce(Response.json({ ...libraryEntry(), id: slug }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    await listLibraryPlayers(
      { query: "Ten Z", cursor: "next token" },
      controller.signal,
    );
    await listLibraryScenarios({
      playerId: libraryEntry().player.id,
      cursor: "scenario page",
    });
    await getLibraryScenario(slug);
    expect(fetcher.mock.calls[0]).toEqual([
      "/api/library/players?query=Ten+Z&cursor=next+token",
      { cache: "no-store", signal: controller.signal },
    ]);
    expect(fetcher.mock.calls[1][0]).toBe(
      `/api/library/scenarios?cursor=scenario+page&playerId=${libraryEntry().player.id}`,
    );
    expect(fetcher.mock.calls[2][0]).toBe(`/api/library/scenarios/${slug}`);
    expect(fetcher.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
});

describe("seeded scenario session identifiers", () => {
  it("starts and parses a seeded single-scenario session while preserving its target", async () => {
    const session = selectedSnapshot();
    session.target = { kind: "scenario", scenarioId: slug };
    session.items[0].challenge.id = slug;
    expect(parseSessionSnapshot(session)).toEqual(session);
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ session, created: true, replayed: false }),
      );
    vi.stubGlobal("fetch", fetcher);
    await createOrResumeSession({
      requestId: commandId,
      target: session.target,
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).target.scenarioId).toBe(
      slug,
    );
    await expect(getSession(slug)).rejects.toThrow();
    await expect(
      createOrResumeSession({ requestId: slug, target: session.target }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    "../account",
    "https://evil.test",
    "scenario?secret=true",
    "BAD-SLUG",
    "one",
    "a-" + "b".repeat(100),
  ])("rejects unsafe scenario target %s", (scenarioId) => {
    expect(() =>
      parseSessionTarget({ kind: "scenario", scenarioId }),
    ).toThrow();
  });
});
