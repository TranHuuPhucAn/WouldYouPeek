import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parsePlaylistDetail,
  parseLibraryPlaylistResponse,
  parseCreatorPlaylistSnapshot,
  parsePlaylistReviewPreview,
  parsePlaylistScenarioCandidates,
} from "@/lib/client/playlist-validation";
import { parseCreatorProfile } from "@/lib/client/creator-profile-api";
import {
  createOrResumeSession,
  parseSessionSnapshot,
  parseSessionSummary,
  validateSessionContinuity,
} from "@/lib/client/session-api";
import { listLibraryPlaylists } from "@/lib/client/playlist-api";
import {
  detail,
  preview,
  playlistSnapshot,
  reviewPreview,
  playlistSession,
  playlistId,
  publicationId,
  candidate,
} from "./playlist-fixtures";
const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
afterEach(() => vi.unstubAllGlobals());
describe("playlist boundaries", () => {
  it("accepts exact metadata, including allowed Unicode whitespace, and rejects answer/media leaks", () => {
    const value = detail();
    value.description = "Line\u000bnext\u000cline\u0085end";
    expect(parsePlaylistDetail(value)).toEqual(value);
    for (const key of ["answer", "videoUrl", "source", "email"])
      expect(() =>
        parsePlaylistDetail({ ...value, [key]: "private" }),
      ).toThrow();
    expect(() =>
      parsePlaylistDetail({
        ...value,
        items: [{ ...value.items[0], question: "leak" }, value.items[1]],
      }),
    ).toThrow();
    expect(() =>
      parsePlaylistDetail({ ...value, description: "bad\u0000" }),
    ).toThrow();
    expect(() =>
      parsePlaylistDetail({ ...value, players: [...value.players].reverse() }),
    ).toThrow();
    expect(() => parsePlaylistDetail({ ...value, itemCount: 3 })).toThrow();
  });
  it("checks pins, revisions, identity, review profile, duplicate rows and exact profile shape", () => {
    expect(parseCreatorPlaylistSnapshot(playlistSnapshot())).toEqual(
      playlistSnapshot(),
    );
    expect(
      parsePlaylistReviewPreview(reviewPreview(), playlistId, 1)
        .profileRevision,
    ).toBe(1);
    expect(() =>
      parsePlaylistReviewPreview({
        ...reviewPreview(),
        profileRevision: undefined,
      }),
    ).toThrow();
    const bad = playlistSnapshot();
    bad.items[0].selection.scenarioVersion = "creator-2";
    expect(() => parseCreatorPlaylistSnapshot(bad)).toThrow();
    expect(() =>
      parseLibraryPlaylistResponse({
        playlists: [preview(), preview()],
        nextCursor: null,
      }),
    ).toThrow();
    expect(() =>
      parsePlaylistScenarioCandidates({
        scenarios: [
          candidate(),
          { ...candidate(), scenarioVersion: "creator-2" },
        ],
        nextCursor: null,
      }),
    ).toThrow();
    expect(parseCreatorProfile({ displayName: "Coach", revision: 2 })).toEqual({
      displayName: "Coach",
      revision: 2,
    });
    expect(() =>
      parseCreatorProfile({
        displayName: "Coach",
        revision: 2,
        email: "private",
      }),
    ).toThrow();
  });
  it("rejects impossible publication and review lifecycle metadata", () => {
    const raw = playlistSnapshot();
    for (const publication of [
      {
        ...raw.publication,
        state: "published",
        currentVersion: publicationId,
        publishedAt: raw.updatedAt,
        availability: null,
      },
      {
        ...raw.publication,
        state: "published",
        currentVersion: publicationId,
        publishedAt: raw.updatedAt,
        availability: "blocked",
        issues: [],
      },
      {
        ...raw.publication,
        state: "withdrawn",
        currentVersion: publicationId,
        publishedAt: raw.updatedAt,
        availability: "available",
      },
    ])
      expect(() =>
        parseCreatorPlaylistSnapshot({ ...raw, publication }),
      ).toThrow();
    expect(() =>
      parseCreatorPlaylistSnapshot({
        ...playlistSnapshot(0),
        readiness: { canReview: true, issues: [] },
      }),
    ).toThrow();
    const foreign = playlistSnapshot();
    foreign.draft.content.items[0].scenarioId = "tenz-bind-clove-r21-peek";
    expect(() => parseCreatorPlaylistSnapshot(foreign)).toThrow();
    const missing = playlistSnapshot();
    missing.items[0].preview = null;
    expect(() => parseCreatorPlaylistSnapshot(missing)).toThrow();
    const preview = reviewPreview();
    preview.items[0] = { ...preview.items[0], title: "Unseen replacement" };
    expect(() => parsePlaylistReviewPreview(preview)).toThrow();
    expect(() =>
      parsePlaylistReviewPreview({ ...reviewPreview(), profileRevision: 0 }),
    ).toThrow();
    expect(() =>
      parsePlaylistReviewPreview({
        ...reviewPreview(),
        credit: { kind: "editorial", displayName: "Fake editorial" },
      }),
    ).toThrow();
  });
  it("sends all public filters and keeps metadata-only results", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ playlists: [preview()], nextCursor: null }),
      );
    vi.stubGlobal("fetch", fetcher);
    await listLibraryPlaylists({
      query: "TenZ",
      playerId: candidate().player.id,
      cursor: "page-2",
    });
    const url = new URL(fetcher.mock.calls[0][0], "https://example.test");
    expect(url.searchParams.get("query")).toBe("TenZ");
    expect(url.searchParams.get("playerId")).toBe(candidate().player.id);
    expect(url.searchParams.get("cursor")).toBe("page-2");
  });
  it("requires the preview version for new sessions, permits older same-playlist resume, and rejects wrong target", async () => {
    const session = playlistSession();
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ session, created: true, replayed: false }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await createOrResumeSession({
      requestId,
      target: { kind: "playlist", playlistId },
      expectedPublicationVersion: publicationId,
    });
    expect(
      JSON.parse(fetcher.mock.calls[0][1].body).expectedPublicationVersion,
    ).toBe(publicationId);
    session.playlist!.publicationVersion = requestId;
    await expect(
      createOrResumeSession({
        requestId,
        target: { kind: "playlist", playlistId },
        expectedPublicationVersion: publicationId,
      }),
    ).rejects.toThrow();
    fetcher.mockImplementation(() =>
      Promise.resolve(
        Response.json({ session, created: false, replayed: false }),
      ),
    );
    await expect(
      createOrResumeSession({
        requestId,
        target: { kind: "playlist", playlistId },
        expectedPublicationVersion: publicationId,
      }),
    ).resolves.toBeDefined();
    session.target = { kind: "playlist", playlistId: requestId };
    await expect(
      createOrResumeSession({
        requestId,
        target: { kind: "playlist", playlistId },
        expectedPublicationVersion: publicationId,
      }),
    ).rejects.toThrow();
  });
  it("accepts saved playlist context and rejects credit or publication changes during a run", () => {
    const session = playlistSession();
    expect(parseSessionSnapshot(session).playlist?.credit.displayName).toBe(
      "Coach Example",
    );
    const changed = structuredClone(session);
    changed.playlist!.credit.displayName = "Changed";
    expect(() => validateSessionContinuity(changed, session)).toThrow();
    expect(() =>
      parseSessionSnapshot({ ...session, playlist: undefined }),
    ).toThrow();
    const summary = {
      id: session.id,
      target: session.target,
      title: session.title,
      status: session.status,
      answeredCount: 0,
      totalCount: 20,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: null,
      playlist: session.playlist,
    };
    expect(parseSessionSummary(summary).totalCount).toBe(20);
    expect(() => parseSessionSummary({ ...summary, totalCount: 1 })).toThrow();
    expect(() => parseSessionSummary({ ...summary, totalCount: 21 })).toThrow();
  });
});
