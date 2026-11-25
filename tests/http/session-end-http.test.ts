import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  CreateSessionResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import type { PlaybackAccess } from "@/contracts/video";
import { createVerifiedTestUser } from "../integration/helpers/test-users";
import {
  createVerifiedCreator,
  publishScenarioFixture,
} from "../integration/helpers/creator-scenarios";
import {
  publishPlaylist,
  saveProfile,
  selected,
  withdrawScenario,
} from "../integration/helpers/playlists";
import {
  fixture,
  objectPath,
  uploadedContent,
  uploadReady,
} from "../integration/helpers/videos";
import { api, loginBrowser } from "./helpers/browser";

describe("early-end HTTP and real Storage authorization", () => {
  it("keeps answered uploaded replay while closing unanswered access through both HTTP and Storage", async () => {
    // Immutable source/publication fixtures are removed only by owned stack disposal.
    const creator = await createVerifiedCreator(),
      learner = await createVerifiedTestUser(),
      zero = await createVerifiedTestUser();
    const browser = await loginBrowser(learner),
      zeroBrowser = await loginBrowser(zero),
      strangerBrowser = await loginBrowser(creator);
    const video = await uploadReady(creator, await fixture());
    const scenario = await publishScenarioFixture(
      creator,
      uploadedContent(video.id),
    );
    const other = await publishScenarioFixture(creator);
    await saveProfile(creator);
    const playlist = await publishPlaylist(creator, [
      selected(scenario),
      selected(other),
    ]);
    const start = await api<CreateSessionResponse>(browser, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "playlist", playlistId: playlist.id },
      expectedPublicationVersion: playlist.publication.currentVersion,
    });
    expect(start.response.status).toBe(200);
    let session = start.data.session;
    const untouched = await api<CreateSessionResponse>(
      zeroBrowser,
      "/api/sessions",
      {
        requestId: randomUUID(),
        target: { kind: "scenario", scenarioId: scenario.id },
      },
    );
    expect(untouched.response.status).toBe(200);
    const item = session.items[0],
      context = {
        kind: "session-item",
        sessionId: session.id,
        itemId: item.id,
        phase: "setup",
      };
    expect(
      (await api(browser, "/api/media/playback", context)).response.status,
    ).toBe(200);
    const answer = await api<SessionMutationResponse>(
      browser,
      `/api/sessions/${session.id}/items/${item.id}/answer`,
      {
        requestId: randomUUID(),
        expectedRevision: session.revision,
        optionId: item.challenge.options[0].id,
      },
    );
    expect(answer.response.status).toBe(200);
    session = answer.data.session;
    const endpoint = `/api/sessions/${session.id}/end`,
      command = { requestId: randomUUID(), expectedRevision: session.revision };
    expect((await api(null, endpoint, command)).response.status).toBe(401);
    expect(
      (await api(strangerBrowser, endpoint, command)).response.status,
    ).toBe(404);
    expect(
      (
        await api(browser, endpoint, command, {
          headers: { Origin: "https://foreign.example" },
        })
      ).response.status,
    ).toBe(400);
    expect(
      (await api(browser, endpoint, { ...command, ownerId: creator.id }))
        .response.status,
    ).toBe(400);
    expect(
      (await api(browser, endpoint, { padding: "x".repeat(1_100) })).response
        .status,
    ).toBe(413);
    await withdrawScenario(creator, scenario);
    const ended = await api<SessionMutationResponse>(
      browser,
      endpoint,
      command,
    );
    expect(ended.response.status).toBe(200);
    expect(ended.data.session).toMatchObject({
      status: "ended",
      phase: "ended",
      revision: 2,
      currentIndex: null,
      completedAt: null,
    });
    expect(ended.data.session.items).toEqual(session.items);
    expect(ended.data.session.endedAt).toBe(ended.data.session.updatedAt);
    const retry = await api<SessionMutationResponse>(
      browser,
      endpoint,
      command,
    );
    expect(retry.response.status).toBe(200);
    expect(retry.data.replayed).toBe(true);
    expect(retry.data.session).toEqual(ended.data.session);
    for (const phase of ["setup", "reveal"]) {
      const access = await api<PlaybackAccess>(browser, "/api/media/playback", {
        ...context,
        phase,
      });
      expect(access.response.status).toBe(200);
      expect(access.data.assetId).toBe(video.id);
      const bytes = await fetch(access.data.url, {
        headers: { Range: "bytes=0-31" },
      });
      expect(bytes.status).toBe(206);
      expect((await bytes.arrayBuffer()).byteLength).toBe(32);
    }
    const zeroSession = untouched.data.session;
    const zeroEnd = await api<SessionMutationResponse>(
      zeroBrowser,
      `/api/sessions/${zeroSession.id}/end`,
      { requestId: randomUUID(), expectedRevision: 0 },
    );
    expect(zeroEnd.response.status).toBe(200);
    expect(zeroEnd.data.session.revision).toBe(1);
    for (const phase of ["setup", "reveal"]) {
      expect(
        (
          await api(zeroBrowser, "/api/media/playback", {
            kind: "session-item",
            sessionId: zeroSession.id,
            itemId: zeroSession.items[0].id,
            phase,
          })
        ).response.status,
      ).toBe(404);
    }
    // No current public source remains; only the answered learner and asset owner have independent grants.
    const path = objectPath(creator, video.id);
    expect(
      (await zero.client.storage.from("creator-vods").createSignedUrl(path, 60))
        .error,
    ).not.toBeNull();
    expect(
      (
        await learner.client.storage
          .from("creator-vods")
          .createSignedUrl(path, 60)
      ).error,
    ).toBeNull();
    expect(
      (
        await creator.client.storage
          .from("creator-vods")
          .createSignedUrl(path, 60)
      ).error,
    ).toBeNull();
    expect(
      (await api<SessionSnapshot>(browser, `/api/sessions/${session.id}`)).data,
    ).toEqual(ended.data.session);
    const again = await api<CreateSessionResponse>(browser, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "scenario", scenarioId: other.id },
    });
    expect(again.response.status).toBe(200);
    expect(again.data.session.id).not.toBe(session.id);
  }, 60_000);
});
