import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreatorScenarioSnapshot } from "@/contracts/creator";
import type { LibraryListResponse } from "@/contracts/library";
import type {
  CreatorPlaylistSnapshot,
  LibraryPlaylistResponse,
} from "@/contracts/playlist";
import type {
  CreateSessionResponse,
  SessionHistoryResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import {
  createDraftFixture,
  createVerifiedCreator,
  publishScenarioFixture,
  saveDraftFixture,
  validContent,
} from "../integration/helpers/creator-scenarios";
import {
  publishPlaylist,
  republishScenario,
  saveProfile,
  selected,
  withdrawScenario,
} from "../integration/helpers/playlists";
import { createLocalTestClient } from "../integration/helpers/local-supabase";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
  type TestUser,
} from "../integration/helpers/test-users";
import { api, appOrigin, loginBrowser, type Browser } from "./helpers/browser";

function expectPrivateNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
}

/** Inspect both rendered HTML and the payload used by an App Router navigation. */
async function page(browser: Browser | null, rsc = false) {
  const headers = new Headers({
    Accept: rsc ? "text/x-component" : "text/html",
  });
  if (rsc) headers.set("RSC", "1");
  if (browser)
    headers.set(
      "Cookie",
      [...browser.jar].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  // With no router-state, prefetch or next-url headers, Next's validated RSC
  // cache key is the empty string. The parameter must still be present: an
  // omitted or invented value correctly triggers a framework 307 redirect.
  const response = await fetch(`${appOrigin()}/${rsc ? "?_rsc=" : ""}`, {
    headers,
    redirect: "manual",
  });
  if (browser)
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        split = pair.indexOf("=");
      const name = pair.slice(0, split),
        value = pair.slice(split + 1);
      if (value && !/max-age=0(?:;|$)/i.test(header))
        browser.jar.set(name, value);
      else browser.jar.delete(name);
    }
  expect(response.status).toBe(200);
  expectPrivateNoStore(response);
  expect(response.headers.get("content-type")).toContain(
    rsc ? "text/x-component" : "text/html",
  );
  return response.text();
}

describe("Home through the production Next server and real account cookies", () => {
  const users: TestUser[] = [];
  const marker = randomUUID();
  const privateAnalysis = `Home private analysis ${marker}`;
  const privateContext = `Home private context ${marker}`;
  const privateDraft = `Home draft ${marker}`;
  const publicFirst = `Home published first ${marker}`;
  const publicSecond = `Home published second ${marker}`;
  const publicPlaylist = `Home ordered collection ${marker}`;
  const privateEdit = `Home unpublished edit ${marker}`;
  let owner: TestUser;
  let a: Browser, b: Browser, empty: Browser, dbUnverified: Browser;
  let aSession: SessionSnapshot,
    bSession: SessionSnapshot,
    gatedSession: SessionSnapshot;
  let firstScenario: CreatorScenarioSnapshot,
    secondScenario: CreatorScenarioSnapshot;
  let playlist: CreatorPlaylistSnapshot;
  let firstContent: ReturnType<typeof validContent>;

  beforeAll(async () => {
    appOrigin();
    owner = await createVerifiedCreator();
    // Published immutable fixtures remain owned until the disposable CI project
    // is destroyed. Never disable history protections to delete their creator.
    await saveProfile(owner, "Home public coach");
    firstContent = validContent();
    firstContent.title = publicFirst;
    firstContent.context = privateContext;
    firstContent.analysis.rationale = privateAnalysis;
    firstContent.source.player = `AAA Home Alpha ${marker}`;
    firstScenario = await publishScenarioFixture(owner, firstContent);
    const secondContent = validContent();
    secondContent.title = publicSecond;
    secondContent.source.player = `AAB Home Beta ${marker}`;
    secondScenario = await publishScenarioFixture(owner, secondContent);
    await createDraftFixture(owner, { ...validContent(), title: privateDraft });
    playlist = await publishPlaylist(
      owner,
      [selected(firstScenario), selected(secondScenario)],
      publicPlaylist,
    );

    for (let index = 0; index < 4; index++)
      users.push(await createVerifiedTestUser());
    [a, b, empty, dbUnverified] = await Promise.all(users.map(loginBrowser));
    const firstStart = await api<CreateSessionResponse>(a, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "playlist", playlistId: playlist.id },
      expectedPublicationVersion: playlist.publication.currentVersion,
    });
    expect(firstStart.response.status).toBe(200);
    aSession = firstStart.data.session;
    const item = aSession.items[0];
    const answered = await api<SessionMutationResponse>(
      a,
      `/api/sessions/${aSession.id}/items/${item.id}/answer`,
      {
        requestId: randomUUID(),
        expectedRevision: aSession.revision,
        optionId: item.challenge.options[0].id,
      },
    );
    expect(answered.response.status).toBe(200);
    aSession = answered.data.session;
    const secondStart = await api<CreateSessionResponse>(b, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "scenario", scenarioId: secondScenario.id },
    });
    expect(secondStart.response.status).toBe(200);
    bSession = secondStart.data.session;
    const gatedStart = await api<CreateSessionResponse>(
      dbUnverified,
      "/api/sessions",
      { requestId: randomUUID(), target: { kind: "demo" } },
    );
    expect(gatedStart.response.status).toBe(200);
    gatedSession = gatedStart.data.session;
    // This is the existing database-verification boundary fixture, not a fake
    // auth cookie: Auth still confirms the user, while private RPC access fails.
    const gated = await createLocalTestClient("admin")
      .from("profiles")
      .update({ email_verified_at: null })
      .eq("user_id", users[3].id);
    expect(gated.error).toBeNull();
  }, 60_000);

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  function expectNoPrivatePayload(output: string) {
    for (const value of [
      privateAnalysis,
      privateContext,
      privateDraft,
      owner.email,
      ...users.map((user) => user.email),
    ])
      expect(output).not.toContain(value);
    expect(output).not.toContain("youtube.com/embed/");
    expect(output).not.toContain("/api/videos/");
    expect(output).not.toMatch(/<iframe\b|<video\b/);
  }

  it.each([false, true])(
    "renders current metadata and matching bounded discovery for guests (RSC=%s)",
    async (rsc) => {
      const catalogue = await api<LibraryListResponse>(
        null,
        "/api/library/scenarios",
      );
      const collections = await api<LibraryPlaylistResponse>(
        null,
        "/api/library/playlists",
      );
      expect(catalogue.response.status).toBe(200);
      expect(collections.response.status).toBe(200);
      const output = await page(null, rsc);
      // The punctuation is a separate styled node in HTML and the RSC tree.
      expect(output).toContain("Your film room");
      expect(output).toContain("/library/bind-clove-smoke-contest");
      for (const scenario of catalogue.data.scenarios
        .filter((item) => item.id !== "bind-clove-smoke-contest")
        .slice(0, 3))
        expect(output).toContain(`/library/${scenario.id}`);
      for (const collection of collections.data.playlists.slice(0, 3))
        expect(output).toContain(`/library/playlists/${collection.id}`);
      expect(output).toContain(publicFirst);
      expect(output).toContain(publicSecond);
      expect(output).toContain(publicPlaylist);
      expect(output).toContain("Home public coach");
      for (const session of [aSession, bSession, gatedSession])
        expect(output).not.toContain(session.id);
      expectNoPrivatePayload(output);
    },
  );

  it.each([false, true])(
    "isolates successive A, B and guest responses (RSC=%s)",
    async (rsc) => {
      const first = await page(a, rsc);
      expect(first).toContain(`/play/${aSession.id}`);
      expect(first).not.toContain(bSession.id);
      expect(first).not.toContain(gatedSession.id);
      expectNoPrivatePayload(first);
      const second = await page(b, rsc);
      expect(second).toContain(`/play/${bSession.id}`);
      expect(second).not.toContain(aSession.id);
      expect(second).not.toContain(gatedSession.id);
      expectNoPrivatePayload(second);
      const guest = await page(null, rsc);
      expect(guest).not.toContain(aSession.id);
      expect(guest).not.toContain(bSession.id);
      expectNoPrivatePayload(guest);
    },
  );

  it("keeps public discovery useful when the existing database verification gate denies private progress", async () => {
    const output = await page(dbUnverified);
    expect(output).toContain("/library/bind-clove-smoke-contest");
    expect(output).toContain("/history");
    expect(output).not.toContain(gatedSession.id);
    expectNoPrivatePayload(output);
  });

  it("does not create sessions or change saved answers, pins, phases or timestamps on repeated Home reads", async () => {
    async function persistedRows() {
      const admin = createLocalTestClient("admin");
      const result = await Promise.all([
        admin
          .from("training_sessions")
          .select("*")
          .in(
            "user_id",
            users.map(({ id }) => id),
          )
          .order("id"),
        admin
          .from("training_session_items")
          .select("*")
          .in(
            "user_id",
            users.map(({ id }) => id),
          )
          .order("id"),
        admin
          .from("attempts")
          .select("*")
          .in(
            "user_id",
            users.map(({ id }) => id),
          )
          .order("id"),
      ]);
      for (const item of result) expect(item.error).toBeNull();
      return result.map(({ data }) => data);
    }
    const before = await persistedRows();
    for (const browser of [a, b, empty, dbUnverified, a, empty])
      await page(browser);
    expect(await persistedRows()).toEqual(before);
    const history = await api<SessionHistoryResponse>(empty, "/api/sessions");
    expect(history.response.status).toBe(200);
    expect(history.data.sessions).toEqual([]);
    const saved = await api<SessionSnapshot>(a, `/api/sessions/${aSession.id}`);
    expect(saved.response.status).toBe(200);
    expect(saved.data).toEqual(aSession);
  });

  it("keeps a creator's unpublished edits out of Home while displaying the current publication", async () => {
    firstContent = { ...firstContent, title: privateEdit };
    firstScenario = await saveDraftFixture(owner, firstScenario, firstContent);
    const output = await page(null);
    expect(output).toContain(publicFirst);
    expect(output).not.toContain(privateEdit);
    expect(output).not.toContain(privateDraft);
  });

  it("removes withdrawn scenarios and blocked playlists without affecting saved resume", async () => {
    firstScenario = await withdrawScenario(owner, firstScenario);
    const output = await page(null);
    expect(output).not.toContain(publicFirst);
    expect(output).not.toContain(`/library/${firstScenario.id}`);
    expect(output).not.toContain(`/library/playlists/${playlist.id}`);
    expect(output).toContain(`/library/${secondScenario.id}`);
    const collections = await api<LibraryPlaylistResponse>(
      null,
      "/api/library/playlists",
    );
    expect(
      collections.data.playlists.some((item) => item.id === playlist.id),
    ).toBe(false);
    const own = await page(a);
    expect(own).toContain(`/play/${aSession.id}`);
    expect(own).toContain(publicPlaylist);
  });

  it("does not revive a stale playlist just because its withdrawn source is republished", async () => {
    firstScenario = await republishScenario(owner, firstScenario);
    const output = await page(null);
    expect(output).toContain(privateEdit);
    expect(output).toContain(`/library/${firstScenario.id}`);
    expect(output).not.toContain(`/library/playlists/${playlist.id}`);
    const collections = await api<LibraryPlaylistResponse>(
      null,
      "/api/library/playlists",
    );
    expect(
      collections.data.playlists.some((item) => item.id === playlist.id),
    ).toBe(false);
  });
});
