import { describe, it, expect } from "vitest";
import fixture from "../../supabase/fixtures/curated-playlist.json";
import {
  toCreatorProfile,
  toCreatorProfileMutation,
} from "@/server/account/creator-profile/projections";
import {
  toLibraryPlaylists,
  toPlaylistDetail,
} from "@/server/playlists/projections";
import {
  toSessionSnapshot,
  toSessionSummary,
} from "@/server/training/projections";
import { safeErrorDetails } from "@/server/http";
import { snapshot } from "./helpers/session";
const player = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "TenZ",
};
const items = fixture.items.map((selection) => ({
  ...selection,
  title: "Decision",
  topic: "Timing",
  player,
  map: "Bind",
  agent: "Clove",
  sourceKind: "youtube",
  provenance: "ai",
}));
const detail = {
  ...fixture,
  players: [player],
  itemCount: 3,
  publishedAt: "2026-11-21T00:00:00Z",
  items,
};
describe("playlist projection boundaries", () => {
  it("projects profile without account identifiers and validates normalized labels", () => {
    expect(
      toCreatorProfile({
        displayName: null,
        revision: 0,
        userId: player.id,
        email: "private@example.test",
      }),
    ).toEqual({ displayName: null, revision: 0 });
    expect(() =>
      toCreatorProfile({ displayName: null, revision: 1 }),
    ).toThrow();
    expect(() =>
      toCreatorProfile({ displayName: " Coach ", revision: 1 }),
    ).toThrow();
    expect(
      toCreatorProfileMutation({
        profile: { displayName: "Coach", revision: 1 },
        replayed: true,
        private: true,
      }),
    ).toEqual({
      profile: { displayName: "Coach", revision: 1 },
      replayed: true,
    });
  });
  it("rejects rather than forwards public previews with private payloads", () => {
    expect(toPlaylistDetail(detail)).toEqual(detail);
    for (const key of [
      "question",
      "options",
      "videoId",
      "assetId",
      "analysis",
      "observedAction",
    ]) {
      expect(() => toPlaylistDetail({ ...detail, [key]: "secret" })).toThrow();
      expect(() =>
        toPlaylistDetail({
          ...detail,
          items: [{ ...items[0], [key]: "secret" }, ...items.slice(1)],
        }),
      ).toThrow();
    }
    expect(() =>
      toPlaylistDetail({ ...detail, items: [items[0], items[0], items[2]] }),
    ).toThrow();
    expect(() =>
      toLibraryPlaylists({ playlists: [detail], nextCursor: null }),
    ).toThrow();
  });
  it("pins metadata on sessions and safe conflict summaries while keeping legacy shapes", () => {
    const legacy = snapshot();
    expect(toSessionSnapshot(legacy)).not.toHaveProperty("playlist");
    const session = {
      ...legacy,
      target: { kind: "playlist" as const, playlistId: fixture.id },
      title: fixture.title,
      playlist: {
        publicationVersion: fixture.publicationVersion,
        credit: fixture.credit,
        players: [player],
      },
    };
    expect(toSessionSnapshot(session).playlist).toEqual(session.playlist);
    expect(() =>
      toSessionSnapshot({
        ...session,
        playlist: { ...session.playlist, creatorEmail: "secret@example.test" },
      }),
    ).toThrow();
    const summary = {
      id: session.id,
      target: session.target,
      title: session.title,
      playlist: session.playlist,
      status: "in_progress",
      answeredCount: 0,
      totalCount: 3,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: null,
    };
    expect(toSessionSummary(summary).playlist).toEqual(session.playlist);
    expect(
      safeErrorDetails("ACTIVE_SESSION_EXISTS", {
        activeSession: { ...summary, private: "secret" },
      }),
    ).toEqual({ activeSession: summary });
    expect(
      safeErrorDetails("ACTIVE_SESSION_EXISTS", {
        activeSession: {
          ...summary,
          playlist: { ...session.playlist, options: [] },
        },
      }),
    ).toBeUndefined();
  });
});
