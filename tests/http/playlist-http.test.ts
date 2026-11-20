import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApiErrorResponse } from "@/contracts/challenge";
import type { CreatorProfileMutationResponse } from "@/contracts/creator-profile";
import type {
  CreatorPlaylistScenarioList,
  CreatorPlaylistSnapshot,
  LibraryPlaylistResponse,
  PlaylistDetail,
  PlaylistMutationResponse,
  PlaylistReviewPreview,
} from "@/contracts/playlist";
import type {
  CreateSessionResponse,
  SessionHistoryResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import {
  createVerifiedCreator,
  publishScenarioFixture,
  validContent,
} from "../integration/helpers/creator-scenarios";
import {
  createVerifiedTestUser,
  type TestUser,
} from "../integration/helpers/test-users";
import {
  expectMetadataOnly,
  playlistChecklist,
  selected,
} from "../integration/helpers/playlists";
import { api, appOrigin, loginBrowser, type Browser } from "./helpers/browser";

describe("playlist lifecycle through production Next HTTP routes and SSR cookies", () => {
  let creator: Browser, learner: Browser, other: Browser;
  let ownerUser: TestUser, learnerUser: TestUser;
  let playlist: CreatorPlaylistSnapshot,
    detail: PlaylistDetail,
    session: SessionSnapshot;
  let profileRevision: number;
  let selections: ReturnType<typeof selected>[];
  const endpoint = () => `/api/creator/playlists/${playlist.id}`;

  beforeAll(async () => {
    appOrigin();
    ownerUser = await createVerifiedCreator();
    learnerUser = await createVerifiedTestUser();
    const otherUser = await createVerifiedCreator();
    [creator, learner, other] = await Promise.all([
      loginBrowser(ownerUser),
      loginBrowser(learnerUser),
      loginBrowser(otherUser),
    ]);
    const one = validContent(),
      two = validContent();
    one.source.player = `HTTP Alpha ${randomUUID()}`;
    two.source.player = `HTTP Beta ${randomUUID()}`;
    selections = [
      selected(await publishScenarioFixture(ownerUser, one)),
      selected(await publishScenarioFixture(ownerUser, two)),
    ];
  });

  async function reviewAndPublish() {
    const reviewed = await api<PlaylistMutationResponse>(
      creator,
      `${endpoint()}/review`,
      {
        requestId: randomUUID(),
        expectedRevision: playlist.revision,
        profileRevision,
        checklist: playlistChecklist(),
      },
    );
    expect(reviewed.response.status).toBe(200);
    playlist = reviewed.data.playlist;
    const published = await api<PlaylistMutationResponse>(
      creator,
      `${endpoint()}/publish`,
      {
        requestId: randomUUID(),
        expectedRevision: playlist.revision,
        reviewId: playlist.review!.id,
      },
    );
    expect(published.response.status).toBe(200);
    playlist = published.data.playlist;
    return published;
  }

  it("requires creator access, saves explicit credit, and isolates drafts and published candidates", async () => {
    expect((await api(null, "/api/creator/playlists")).response.status).toBe(
      401,
    );
    expect((await api(learner, "/api/creator/playlists")).response.status).toBe(
      403,
    );
    expect(
      (await api(learner, "/api/account/creator-profile")).response.status,
    ).toBe(403);
    expect((await api(null, "/api/library/playlists")).response.status).toBe(
      200,
    );
    const profile = await api<CreatorProfileMutationResponse>(
      creator,
      "/api/account/creator-profile",
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        displayName: "HTTP Public Coach",
      },
      { method: "PUT" },
    );
    expect(profile.response.status).toBe(200);
    profileRevision = profile.data.profile.revision;
    const createBody = { requestId: randomUUID() };
    const created = await api<PlaylistMutationResponse>(
      creator,
      "/api/creator/playlists",
      createBody,
    );
    expect(created.response.status).toBe(200);
    playlist = created.data.playlist;
    expect(
      (
        await api<PlaylistMutationResponse>(
          creator,
          "/api/creator/playlists",
          createBody,
        )
      ).data,
    ).toMatchObject({ replayed: true, playlist: { id: playlist.id } });
    const foreign = await api(other, endpoint()),
      unknown = await api(other, `/api/creator/playlists/${randomUUID()}`);
    expect(foreign.response.status).toBe(404);
    expect(foreign.data).toEqual(unknown.data);
    expect(
      (await api(null, `/api/library/playlists/${playlist.id}`)).data,
    ).toEqual((await api(null, `/api/library/playlists/${randomUUID()}`)).data);
    const saved = await api<PlaylistMutationResponse>(
      creator,
      endpoint(),
      {
        requestId: randomUUID(),
        expectedRevision: playlist.revision,
        content: {
          title: "HTTP mixed-player sequence",
          description: "Two decisions in their reviewed order.",
          items: selections,
        },
      },
      { method: "PUT" },
    );
    expect(saved.response.status).toBe(200);
    playlist = saved.data.playlist;
    const candidates = await api<CreatorPlaylistScenarioList>(
      creator,
      "/api/creator/playlist-scenarios",
    );
    expect(candidates.response.status).toBe(200);
    expect(
      new Set(candidates.data.scenarios.map((item) => item.scenarioId)),
    ).toEqual(new Set(selections.map((item) => item.scenarioId)));
    expectMetadataOnly(candidates.data, ownerUser);
    const preview = await api<PlaylistReviewPreview>(
      creator,
      `${endpoint()}/review?revision=${playlist.revision}`,
    );
    expect(preview.response.status).toBe(200);
    expect(preview.data.profileRevision).toBe(profileRevision);
    expect(preview.data.items.map((item) => item.scenarioId)).toEqual(
      selections.map((item) => item.scenarioId),
    );
    expectMetadataOnly(preview.data.items, ownerUser);
    expect(
      (await api<SessionHistoryResponse>(creator, "/api/sessions")).data
        .sessions,
    ).toHaveLength(0);
  });

  it("publishes safe guest metadata, rejects stale previews, and preserves an active original session", async () => {
    await reviewAndPublish();
    const publicDetail = await api<PlaylistDetail>(
      null,
      `/api/library/playlists/${playlist.id}`,
    );
    expect(publicDetail.response.status).toBe(200);
    detail = publicDetail.data;
    expectMetadataOnly(detail, ownerUser);
    expect(detail.credit).toEqual({
      kind: "creator",
      displayName: "HTTP Public Coach",
    });
    for (const player of detail.players) {
      const filtered = await api<LibraryPlaylistResponse>(
        null,
        `/api/library/playlists?playerId=${player.id}`,
      );
      expect(filtered.response.status).toBe(200);
      expect(
        filtered.data.playlists.find((item) => item.id === playlist.id)
          ?.itemCount,
      ).toBe(2);
    }
    const startBody = {
      requestId: randomUUID(),
      target: { kind: "playlist", playlistId: playlist.id },
      expectedPublicationVersion: detail.publicationVersion,
    };
    expect((await api(null, "/api/sessions", startBody)).response.status).toBe(
      401,
    );
    const { expectedPublicationVersion: ignored, ...missingVersion } =
      startBody;
    void ignored;
    expect(
      (await api(learner, "/api/sessions", missingVersion)).response.status,
    ).toBe(400);
    await reviewAndPublish();
    const stale = await api<ApiErrorResponse>(
      learner,
      "/api/sessions",
      startBody,
    );
    expect(stale.response.status).toBe(409);
    expect(stale.data.error.code).toBe("PLAYLIST_CHANGED");
    expect(
      (await api<SessionHistoryResponse>(learner, "/api/sessions")).data
        .sessions,
    ).toHaveLength(0);
    const started = await api<CreateSessionResponse>(learner, "/api/sessions", {
      ...startBody,
      requestId: randomUUID(),
      expectedPublicationVersion: playlist.publication.currentVersion,
    });
    expect(started.response.status).toBe(200);
    session = started.data.session;
    expect(session.items.map((item) => item.challenge.id)).toEqual(
      selections.map((item) => item.scenarioId),
    );
    expect(session.playlist?.publicationVersion).toBe(
      playlist.publication.currentVersion,
    );
    const conflict = await api<ApiErrorResponse>(learner, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "demo" },
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.data.error.code).toBe("ACTIVE_SESSION_EXISTS");
    expect(conflict.data.error.details).toMatchObject({
      activeSession: { id: session.id },
    });
    expectMetadataOnly(conflict.data.error.details);
    expect(
      (await api(other, `/api/sessions/${session.id}`)).response.status,
    ).toBe(404);
  });

  it("hides withdrawn details but lets existing session cookies answer, reload, advance and finish", async () => {
    const withdrawn = await api<PlaylistMutationResponse>(
      creator,
      `${endpoint()}/unpublish`,
      { requestId: randomUUID(), expectedRevision: playlist.revision },
    );
    expect(withdrawn.response.status).toBe(200);
    playlist = withdrawn.data.playlist;
    const unavailable = await api(
        null,
        `/api/library/playlists/${playlist.id}`,
      ),
      missing = await api(null, `/api/library/playlists/${randomUUID()}`);
    expect(unavailable.response.status).toBe(404);
    expect(unavailable.data).toEqual(missing.data);
    expect(
      (
        await api(other, "/api/sessions", {
          requestId: randomUUID(),
          target: { kind: "playlist", playlistId: playlist.id },
          expectedPublicationVersion: playlist.publication.currentVersion,
        })
      ).response.status,
    ).toBe(404);
    const resumed = await api<CreateSessionResponse>(learner, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "playlist", playlistId: playlist.id },
      expectedPublicationVersion: detail.publicationVersion,
    });
    expect(resumed.response.status).toBe(200);
    expect(resumed.data.created).toBe(false);
    expect(resumed.data.session.id).toBe(session.id);
    const first = session.items[0];
    const answerBody = {
      requestId: randomUUID(),
      expectedRevision: session.revision,
      optionId: first.challenge.options[0].id,
    };
    const answered = await api<SessionMutationResponse>(
      learner,
      `/api/sessions/${session.id}/items/${first.id}/answer`,
      answerBody,
    );
    expect(answered.response.status).toBe(200);
    session = answered.data.session;
    learner = await loginBrowser(learnerUser);
    expect(
      (await api<SessionSnapshot>(learner, `/api/sessions/${session.id}`)).data,
    ).toEqual(session);
    expect(
      (
        await api<SessionMutationResponse>(
          learner,
          `/api/sessions/${session.id}/items/${first.id}/answer`,
          answerBody,
        )
      ).data.replayed,
    ).toBe(true);
    while (session.phase !== "completed") {
      const item = session.items[session.currentIndex!];
      const result =
        session.phase === "setup"
          ? await api<SessionMutationResponse>(
              learner,
              `/api/sessions/${session.id}/items/${item.id}/answer`,
              {
                requestId: randomUUID(),
                expectedRevision: session.revision,
                optionId: item.challenge.options[0].id,
              },
            )
          : await api<SessionMutationResponse>(
              learner,
              `/api/sessions/${session.id}/advance`,
              {
                requestId: randomUUID(),
                expectedRevision: session.revision,
                fromItemId: item.id,
              },
            );
      expect(result.response.status).toBe(200);
      session = result.data.session;
    }
    expect(
      (await api<SessionHistoryResponse>(learner, "/api/sessions")).data
        .sessions,
    ).toContainEqual(
      expect.objectContaining({
        id: session.id,
        totalCount: 2,
        answeredCount: 2,
        playlist: session.playlist,
        status: "completed",
      }),
    );
  });

  it("rejects invalid bodies, foreign-origin writes, stale revisions and unsupported query shapes without mutation", async () => {
    const before = playlist.revision;
    const body = {
      requestId: randomUUID(),
      expectedRevision: before,
      content: playlist.draft.content,
    };
    const invalidWrites: NonNullable<Parameters<typeof api>[3]>[] = [
      { method: "PUT", headers: { Origin: "https://foreign.example" } },
      { method: "PUT", headers: { "Content-Type": "text/plain" } },
      { method: "PUT", rawBody: "{" },
    ];
    for (const options of invalidWrites)
      expect(
        (await api(creator, endpoint(), body, options)).response.status,
      ).toBe(400);
    expect(
      (
        await api(
          creator,
          endpoint(),
          { ...body, ownerId: randomUUID() },
          { method: "PUT" },
        )
      ).response.status,
    ).toBe(400);
    expect(
      (
        await api(creator, endpoint(), undefined, {
          method: "PUT",
          rawBody: JSON.stringify({ padding: "🙂".repeat(18_000) }),
        })
      ).response.status,
    ).toBe(413);
    expect(
      (
        await api(
          creator,
          endpoint(),
          { ...body, expectedRevision: before - 1 },
          { method: "PUT" },
        )
      ).response.status,
    ).toBe(409);
    expect(
      (
        await api(
          creator,
          "/api/account/creator-profile",
          {
            requestId: randomUUID(),
            expectedRevision: profileRevision - 1,
            displayName: "Stale credit",
          },
          { method: "PUT" },
        )
      ).response.status,
    ).toBe(409);
    for (const path of [
      "/api/library/playlists?query=a&query=b",
      "/api/library/playlists?cursor=garbage",
      "/api/library/playlists?playerId=bad",
      "/api/library/playlists?limit=1000",
      "/api/creator/playlists?status=all&status=published",
      "/api/creator/playlist-scenarios?unexpected=1",
      `${endpoint()}/review?revision=01`,
      "/api/library/playlists/not-a-uuid",
    ])
      expect((await api(creator, path)).response.status, path).toBe(400);
    expect(
      (await api<CreatorPlaylistSnapshot>(creator, endpoint())).data.revision,
    ).toBe(before);
  });
});
