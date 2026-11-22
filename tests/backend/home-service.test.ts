import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountUser } from "@/contracts/auth";
import type { LibraryScenarioPreview } from "@/contracts/library";
import type { PlaylistPreview } from "@/contracts/playlist";
import type { SessionSummary } from "@/contracts/session";
import { TENZ_PLAYER_ID } from "@/contracts/player";
import { ApiError } from "@/server/http";
import { toLibraryPreview } from "@/server/library/projections";
import { snapshot } from "./helpers/session";

const mocks = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  getLibraryScenario: vi.fn(),
  getPlayers: vi.fn(),
  listPublishedPlaylists: vi.fn(),
  getActiveSessionSummary: vi.fn(),
}));
vi.mock("@/server/library/service", () => mocks);
vi.mock("@/server/players/service", () => mocks);
vi.mock("@/server/playlists/service", () => mocks);
vi.mock("@/server/training/service", () => mocks);
import { getHomePageData } from "@/server/home/service";

const viewer: AccountUser = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "learner@example.test",
  emailVerified: true,
  role: "learner",
  capabilities: ["learn"],
  createdAt: "2026-11-21T00:00:00Z",
};
const preferredId = "bind-clove-smoke-contest";
function previews() {
  return snapshot().items.map(({ challenge }) =>
    toLibraryPreview({
      ...challenge,
      player: { id: TENZ_PLAYER_ID, displayName: "TenZ" },
      editorialOrigin: "curated",
      provenance: "ai",
      publishedAt: null,
    }),
  );
}
function playlist(index = 0): PlaylistPreview {
  return {
    id: `playlist-${index}`,
    publicationVersion: `version-${index}`,
    title: `Collection ${index}`,
    description: "Two perspectives",
    credit: {
      kind: index === 0 ? "editorial" : "creator",
      displayName: "Public credit",
    },
    players: [
      { id: TENZ_PLAYER_ID, displayName: "TenZ" },
      {
        id: "20000000-0000-4000-8000-000000000002",
        displayName: "Another player",
      },
    ],
    itemCount: 2,
    publishedAt: "2026-11-21T00:00:00Z",
  };
}
function summary(
  target: SessionSummary["target"] = { kind: "demo" },
): SessionSummary {
  return {
    id: "30000000-0000-4000-8000-000000000003",
    target,
    title: "Saved practice",
    status: "in_progress",
    answeredCount: 1,
    totalCount: 3,
    createdAt: "2026-11-21T00:00:00Z",
    updatedAt: "2026-11-21T00:01:00Z",
    completedAt: null,
    endedAt: null,
    ...(target.kind === "playlist"
      ? {
          playlist: {
            publicationVersion: "original-version",
            credit: playlist().credit,
            players: playlist().players,
          },
        }
      : {}),
  };
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  const scenarios = previews();
  mocks.getLibrary.mockResolvedValue({ scenarios, nextCursor: null });
  mocks.getLibraryScenario.mockResolvedValue(
    scenarios.find((item) => item.id === preferredId),
  );
  mocks.getPlayers.mockResolvedValue({
    players: [{ player: scenarios[0].player, scenarioCount: 3, scenarios }],
    nextCursor: null,
  });
  mocks.listPublishedPlaylists.mockResolvedValue({
    playlists: [playlist()],
    nextCursor: null,
  });
  mocks.getActiveSessionSummary.mockResolvedValue(null);
});

describe("Home bounded read composition", () => {
  it("uses the current preferred feature and two distinct seeded moments with real counts", async () => {
    const result = await getHomePageData(null);
    expect(result.featured).toMatchObject({
      status: "ready",
      data: { id: preferredId, publishedAt: null },
    });
    expect(result.moments).toMatchObject({
      status: "ready",
      data: previews()
        .filter((p) => p.id !== preferredId)
        .map((p) => ({ id: p.id })),
    });
    expect(result.players).toEqual({
      status: "ready",
      data: [{ player: previews()[0].player, scenarioCount: 3 }],
    });
    expect(result.playlists).toEqual({ status: "ready", data: [playlist()] });
    expect(result.resume).toEqual({ status: "guest" });
    expect(mocks.getLibraryScenario).toHaveBeenCalledExactlyOnceWith(
      preferredId,
    );
    expect(mocks.getLibrary).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.getPlayers).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.listPublishedPlaylists).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.getActiveSessionSummary).not.toHaveBeenCalled();
  });

  it("reads independent sources concurrently and never follows cursors or adds per-card queries", async () => {
    let finish!: (value: {
      scenarios: LibraryScenarioPreview[];
      nextCursor: string;
    }) => void;
    mocks.getLibrary.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = getHomePageData(viewer);
    for (const mock of Object.values(mocks))
      expect(mock).toHaveBeenCalledTimes(1);
    finish({ scenarios: previews(), nextCursor: "more-scenarios" });
    await pending;
    for (const mock of Object.values(mocks))
      expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retains ordered limits and a preferred feature outside the first catalogue page", async () => {
    const scenarios = Array.from({ length: 20 }, (_, index) => ({
      ...previews()[0],
      id: `scenario-${index}`,
    }));
    mocks.getLibrary.mockResolvedValue({
      scenarios,
      nextCursor: "next-scenarios",
    });
    const groups = Array.from({ length: 12 }, (_, index) => ({
      player: { id: `player-${index}`, displayName: `Player ${index}` },
      scenarioCount: 37 + index,
      scenarios: [scenarios[0]],
    }));
    mocks.getPlayers.mockResolvedValue({
      players: groups,
      nextCursor: "next-players",
    });
    mocks.listPublishedPlaylists.mockResolvedValue({
      playlists: Array.from({ length: 20 }, (_, index) => playlist(index)),
      nextCursor: "next-playlists",
    });
    const result = await getHomePageData(null);
    expect(result.featured).toMatchObject({ data: { id: preferredId } });
    expect(result.moments).toMatchObject({
      data: [{ id: "scenario-0" }, { id: "scenario-1" }, { id: "scenario-2" }],
    });
    expect(result.players).toEqual({
      status: "ready",
      data: groups
        .slice(0, 4)
        .map(({ player, scenarioCount }) => ({ player, scenarioCount })),
    });
    expect(result.playlists).toEqual({
      status: "ready",
      data: [playlist(0), playlist(1), playlist(2)],
    });
    for (const mock of [
      mocks.getLibrary,
      mocks.getPlayers,
      mocks.listPublishedPlaylists,
    ])
      expect(mock).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "failed"])(
    "falls back to the ordered catalogue when preferred is %s",
    async (state) => {
      mocks.getLibraryScenario.mockRejectedValue(
        new ApiError(
          state === "missing" ? "SCENARIO_UNAVAILABLE" : "STORAGE_UNAVAILABLE",
          "private diagnostic",
        ),
      );
      const result = await getHomePageData(null);
      expect(result.featured).toMatchObject({
        status: "ready",
        data: { id: previews()[0].id },
      });
      expect(result.moments).toMatchObject({
        data: previews()
          .slice(1)
          .map(({ id }) => ({ id })),
      });
      expect(JSON.stringify(result)).not.toContain("private diagnostic");
    },
  );

  it.each([
    ["missing", "empty", "ready"],
    ["failed", "empty", "unavailable"],
    ["missing", "failed", "unavailable"],
    ["failed", "failed", "unavailable"],
  ])(
    "distinguishes preferred %s / catalogue %s as %s",
    async (preferred, catalogue, status) => {
      mocks.getLibraryScenario.mockRejectedValue(
        new ApiError(
          preferred === "missing"
            ? "SCENARIO_UNAVAILABLE"
            : "STORAGE_UNAVAILABLE",
          "hidden",
        ),
      );
      if (catalogue === "empty")
        mocks.getLibrary.mockResolvedValue({ scenarios: [], nextCursor: null });
      else
        mocks.getLibrary.mockRejectedValue(new Error("hidden provider error"));
      const result = await getHomePageData(null);
      expect(result.featured).toEqual(
        status === "ready" ? { status, data: null } : { status },
      );
      expect(result.players.status).toBe("ready");
      expect(result.playlists.status).toBe("ready");
    },
  );

  it("keeps a healthy feature when its independent catalogue feed fails", async () => {
    mocks.getLibrary.mockRejectedValue(new Error("private diagnostic"));
    const result = await getHomePageData(null);
    expect(result.featured).toMatchObject({
      status: "ready",
      data: { id: preferredId },
    });
    expect(result.moments).toEqual({ status: "unavailable" });
    expect(result.players.status).toBe("ready");
  });

  it.each([0, 1, 3])(
    "does not invent moments when %i catalogue entries remain",
    async (size) => {
      const scenarios = previews()
        .filter(({ id }) => id !== preferredId)
        .slice(0, size);
      mocks.getLibrary.mockResolvedValue({ scenarios, nextCursor: null });
      const result = await getHomePageData(null);
      expect(result.moments).toMatchObject({
        status: "ready",
        data: scenarios.map(({ id }) => ({ id })),
      });
    },
  );

  it("settles public section and private read failures separately without exposing diagnostics", async () => {
    mocks.getPlayers.mockRejectedValue(
      new ApiError("STORAGE_UNAVAILABLE", "private-profile"),
    );
    mocks.listPublishedPlaylists.mockRejectedValue(
      new Error("private-playlist"),
    );
    mocks.getActiveSessionSummary.mockRejectedValue(
      new Error("private-session"),
    );
    const result = await getHomePageData(viewer);
    expect(result.players).toEqual({ status: "unavailable" });
    expect(result.playlists).toEqual({ status: "unavailable" });
    expect(result.resume).toEqual({ status: "unavailable" });
    expect(result.featured.status).toBe("ready");
    expect(result.moments.status).toBe("ready");
    expect(JSON.stringify(result)).not.toMatch(
      /private-profile|private-playlist|private-session/,
    );
  });

  it("represents healthy empty sections separately from failures", async () => {
    mocks.getPlayers.mockResolvedValue({ players: [], nextCursor: null });
    mocks.listPublishedPlaylists.mockResolvedValue({
      playlists: [],
      nextCursor: null,
    });
    const result = await getHomePageData(viewer);
    expect(result.players).toEqual({ status: "ready", data: [] });
    expect(result.playlists).toEqual({ status: "ready", data: [] });
    expect(result.resume).toEqual({ status: "ready", data: null });
  });

  it.each(["learner", "creator"] as const)(
    "never reads private progress for an unverified %s",
    async (role) => {
      const result = await getHomePageData({
        ...viewer,
        role,
        emailVerified: false,
      });
      expect(result.resume).toEqual({ status: "unverified" });
      expect(mocks.getActiveSessionSummary).not.toHaveBeenCalled();
      expect(result.featured.status).toBe("ready");
    },
  );

  it.each([
    { kind: "demo" } as const,
    { kind: "scenario", scenarioId: preferredId } as const,
    { kind: "playlist", playlistId: "playlist" } as const,
  ])(
    "returns the existing verified summary for a $kind session without detail reads",
    async (target) => {
      const active = summary(target);
      mocks.getActiveSessionSummary.mockResolvedValue(active);
      expect((await getHomePageData(viewer)).resume).toEqual({
        status: "ready",
        data: active,
      });
      expect(mocks.getActiveSessionSummary).toHaveBeenCalledExactlyOnceWith();
    },
  );

  it("keeps each request's summary separate rather than caching the preceding account", async () => {
    const first = summary(),
      second = {
        ...summary(),
        id: "different-session",
        title: "Another private title",
      };
    mocks.getActiveSessionSummary
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    expect((await getHomePageData(viewer)).resume).toEqual({
      status: "ready",
      data: first,
    });
    expect(
      (await getHomePageData({ ...viewer, id: "other-user" })).resume,
    ).toEqual({ status: "ready", data: second });
    expect((await getHomePageData(null)).resume).toEqual({ status: "guest" });
    expect(mocks.getActiveSessionSummary).toHaveBeenCalledTimes(2);
  });
});
