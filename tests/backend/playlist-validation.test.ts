import { describe, it, expect } from "vitest";
import vectors from "../fixtures/playlist-content-cases.json";
import {
  normalizeCreatorDisplayName,
  validateCreatorDisplayName,
  normalizePlaylistDraft,
  validatePlaylistDraft,
  validatePlaylistPublishContent,
} from "@/lib/playlists/content";
import { parseSaveCreatorProfile } from "@/server/account/creator-profile/validation";
import {
  parseSavePlaylist,
  parseReviewPlaylist,
} from "@/server/creator-playlists/validation";
import { parsePlaylistCursor } from "@/server/playlists/cursors";
import { parsePlaylistFilters } from "@/server/playlists/validation";
import { parseStartSession } from "@/server/training/validation";
import { PLAYLIST_REVIEW_CHECKLIST_KEYS } from "@/contracts/playlist";
const id = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222";
const content = {
  title: "Practice",
  description: "",
  items: [{ scenarioId: id, scenarioVersion: "creator-1" }],
};
const checklist = Object.fromEntries(
  PLAYLIST_REVIEW_CHECKLIST_KEYS.map((k) => [k, true]),
);
describe("playlist commands and text policy", () => {
  it("normalizes names without stripping accents or conflating them with player identity", () => {
    expect(normalizeCreatorDisplayName("  TénZ\t\u0085Coach  ")).toBe(
      "TénZ Coach",
    );
    expect(validateCreatorDisplayName("😀".repeat(50))).toEqual([]);
    expect(validateCreatorDisplayName("😀".repeat(51))).not.toEqual([]);
    expect(validateCreatorDisplayName("x")).not.toEqual([]);
    expect(validateCreatorDisplayName("Coach\u0007")).not.toEqual([]);
    expect(
      parseSaveCreatorProfile({
        requestId,
        expectedRevision: 0,
        displayName: " TénZ Coach ",
      }),
    ).toEqual({ requestId, expectedRevision: 0, displayName: "TénZ Coach" });
  });
  it("supports blank private drafts, bounds by codepoints, and rejects extra/private fields", () => {
    expect(
      validatePlaylistDraft({ title: "", description: "", items: [] }),
    ).toEqual([]);
    expect(
      validatePlaylistPublishContent({
        title: "",
        description: "",
        items: [],
      }).map((i) => i.path),
    ).toEqual(["title", "items"]);
    expect(
      validatePlaylistDraft({
        ...content,
        title: "😀".repeat(120),
        description: "😀".repeat(1000),
      }),
    ).toEqual([]);
    expect(
      validatePlaylistDraft({ ...content, title: "😀".repeat(121) }),
    ).not.toEqual([]);
    expect(validatePlaylistDraft({ ...content, creatorId: id })).not.toEqual(
      [],
    );
    expect(
      validatePlaylistDraft({
        ...content,
        items: [{ ...content.items[0], versionId: id }],
      }),
    ).not.toEqual([]);
    expect(
      normalizePlaylistDraft({
        ...content,
        title: " A\t\u0085 B ",
        description: "  Line 1\nLine 2  ",
      }),
    ).toMatchObject({ title: "A B", description: "Line 1\nLine 2" });
  });
  it("rejects duplicates regardless of UUID case and a twenty-first item", () => {
    const mixed = "abcdefab-1111-4111-8111-111111111111";
    expect(
      validatePlaylistDraft({
        ...content,
        items: [
          { scenarioId: mixed, scenarioVersion: "creator-1" },
          { scenarioId: mixed.toUpperCase(), scenarioVersion: "creator-2" },
        ],
      }),
    ).not.toEqual([]);
    const items = Array.from({ length: 20 }, (_, i) => ({
      scenarioId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      scenarioVersion: "creator-1",
    }));
    expect(validatePlaylistPublishContent({ ...content, items })).toEqual([]);
    expect(
      validatePlaylistDraft({
        ...content,
        items: [
          ...items,
          { scenarioId: requestId, scenarioVersion: "creator-2" },
        ],
      }),
    ).not.toEqual([]);
  });
  it("binds review to the seen profile revision and exact checklist", () => {
    expect(
      parseReviewPlaylist({
        requestId,
        expectedRevision: 3,
        profileRevision: 2,
        checklist,
      }),
    ).toMatchObject({ profileRevision: 2 });
    for (const input of [
      { requestId, expectedRevision: 3, checklist },
      {
        requestId,
        expectedRevision: 3,
        profileRevision: 2,
        checklist: { ...checklist, creditChecked: false },
      },
      {
        requestId,
        expectedRevision: 3,
        profileRevision: 2,
        checklist,
        creatorId: id,
      },
    ])
      expect(() => parseReviewPlaylist(input)).toThrow();
    expect(() =>
      parseSavePlaylist({ requestId, expectedRevision: -1, content }),
    ).toThrow();
  });
  it("requires a publication pin only for playlist starts", () => {
    const target = { kind: "playlist", playlistId: id };
    expect(
      parseStartSession({
        requestId,
        target,
        expectedPublicationVersion: requestId,
      }),
    ).toEqual({ requestId, target, expectedPublicationVersion: requestId });
    for (const input of [
      { requestId, target },
      { requestId, target, expectedPublicationVersion: "creator-1" },
      {
        requestId,
        target: { kind: "demo" },
        expectedPublicationVersion: requestId,
      },
      {
        requestId,
        target: { ...target, creatorId: id },
        expectedPublicationVersion: requestId,
      },
    ])
      expect(() => parseStartSession(input)).toThrow();
    expect(parseStartSession({ requestId })).toEqual({ requestId });
  });
});
describe("view-bound playlist cursors", () => {
  const filter = { query: "tenz", playerId: id };
  const raw = {
    v: 1,
    kind: "library-playlists",
    filter,
    at: "2026-11-21T00:00:00+00:00",
    id,
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  it("retains exact normalized filter and rejects view, query and player drift", () => {
    expect(parsePlaylistFilters(" TENZ ", id, encode(raw))).toEqual({
      query: "tenz",
      playerId: id,
      cursor: encode(raw),
    });
    for (const [kind, changed] of [
      ["creator-playlists", filter],
      ["library-playlists", { ...filter, query: "other" }],
      ["library-playlists", { ...filter, playerId: null }],
    ] as const)
      expect(() => parsePlaylistCursor(encode(raw), kind, changed)).toThrow();
  });
  it.each([
    "not!base64",
    "AA",
    encode({ ...raw, extra: true }),
    encode({ ...raw, v: 2 }),
    encode({ ...raw, at: "yesterday" }),
    encode({ ...raw, id: "invalid" }),
    encode({ ...raw, filter: { ...filter, extra: 1 } }),
  ])("rejects malformed cursor %s", (cursor) =>
    expect(() =>
      parsePlaylistCursor(cursor, "library-playlists", filter),
    ).toThrow(),
  );
});

describe("shared JS and SQL playlist vectors", () => {
  it.each(vectors.cases)("$name", (test) => {
    const content = { ...vectors.validContent, [test.path]: test.value };
    expect(validatePlaylistDraft(content).length === 0).toBe(test.draftValid);
    expect(validatePlaylistPublishContent(content).length === 0).toBe(
      test.publishValid,
    );
  });
  it.each(vectors.names)("$name", (test) => {
    expect(validateCreatorDisplayName(test.input).length === 0).toBe(
      test.valid,
    );
    if (test.valid)
      expect(normalizeCreatorDisplayName(test.input)).toBe(test.normalized);
  });
});
