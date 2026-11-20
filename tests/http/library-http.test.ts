import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiErrorResponse } from "@/contracts/challenge";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import { TENZ_PLAYER_ID, type PlayerListResponse } from "@/contracts/player";
import type {
  CreateSessionResponse,
  SessionHistoryResponse,
} from "@/contracts/session";
import demos from "../../supabase/fixtures/demo-scenarios.json";
import {
  createDraftFixture,
  createVerifiedCreator,
  publishScenarioFixture,
  validContent,
} from "../integration/helpers/creator-scenarios";
import { createLocalTestClient } from "../integration/helpers/local-supabase";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
  type TestUser,
} from "../integration/helpers/test-users";
import { api, appOrigin, loginBrowser, type Browser } from "./helpers/browser";

/** Real page requests use the same provider-generated cookie jar as JSON calls. */
async function page(browser: Browser | null, path: string) {
  const headers = new Headers({ Accept: "text/html" });
  if (browser)
    headers.set(
      "Cookie",
      [...browser.jar].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  const response = await fetch(`${appOrigin()}${path}`, {
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
  return { response, html: await response.text() };
}

type PageResult = Awaited<ReturnType<typeof page>>;
function expectRedirect(result: PageResult, destination: string) {
  let location: string | null;
  if ([307, 308].includes(result.response.status)) {
    location = result.response.headers.get("location");
  } else {
    // Next may flush a shell before an asynchronous page redirect is known.
    expect(result.response.status).toBe(200);
    const meta = result.html.match(
      /<meta\b[^>]*http-equiv="refresh"[^>]*>/i,
    )?.[0];
    expect(meta).toBeTruthy();
    location = meta?.match(/content="\d+;url=([^"]+)"/i)?.[1] ?? null;
  }
  expect(location).toBeTruthy();
  const url = new URL(location!, appOrigin());
  expect(url.origin).toBe(appOrigin());
  expect(`${url.pathname}${url.search}`).toBe(destination);
}

function expectUnavailable(result: PageResult) {
  expect([200, 404]).toContain(result.response.status);
  expect(result.html).toContain("This page isn’t available.");
  // Streamed notFound responses use 200 plus noindex rather than an HTTP 404.
  if (result.response.status === 200)
    expect(result.html).toMatch(
      /<meta\b(?=[^>]*name="robots")(?=[^>]*content="noindex")[^>]*>/,
    );
}

function expectSafePreview(preview: LibraryScenarioPreview) {
  expect(Object.keys(preview).sort()).toEqual([
    "context",
    "editorialOrigin",
    "id",
    "mediaStatus",
    "order",
    "player",
    "provenance",
    "publishedAt",
    "setup",
    "source",
    "title",
    "topic",
  ]);
  const forbidden = new Set([
    "question",
    "options",
    "decision",
    "knownFacts",
    "unknowns",
    "reveal",
    "answer",
    "analysis",
    "observedAction",
    "optionFeedback",
    "ownerId",
    "creatorId",
    "email",
    "draft",
    "storageKey",
    "storagePath",
    "signedUrl",
  ]);
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      expect(forbidden.has(key), `Public preview must not contain ${key}`).toBe(
        false,
      );
      inspect(nested);
    }
  }
  inspect(preview);
}

function cursor(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("public player Library through real Next HTTP routes", () => {
  const users: TestUser[] = [];
  const playerName = `HTTP Library ${randomUUID()}`;
  let emptyLearner: Browser, unverified: Browser;
  let unverifiedUser: TestUser;
  let playerId: string, draftId: string;
  const publishedIds: string[] = [];
  const seedBrowsers: Browser[] = [];

  beforeAll(async () => {
    appOrigin();
    const dormant = await createVerifiedTestUser();
    users.push(dormant);
    emptyLearner = await loginBrowser(dormant);
    unverifiedUser = await createVerifiedTestUser();
    users.push(unverifiedUser);
    unverified = await loginBrowser(unverifiedUser);
    // Preserve genuine SSR cookies while making the database verification gate fail.
    // Auth metadata stays confirmed; this fixture specifically tests the DB boundary.
    const changed = await createLocalTestClient("admin")
      .from("profiles")
      .update({ email_verified_at: null })
      .eq("user_id", unverifiedUser.id);
    expect(changed.error).toBeNull();
    for (let index = 0; index < demos.length; index++) {
      const user = await createVerifiedTestUser();
      users.push(user);
      seedBrowsers.push(await loginBrowser(user));
    }
    const creator = await createVerifiedCreator();
    // Published fixture ownership is retained in the disposable project because
    // immutable scenario history must not be bypassed for test cleanup.
    for (let index = 0; index < 4; index++) {
      const content = validContent();
      content.source.player = playerName;
      content.title = `${playerName} scenario ${index + 1}`;
      publishedIds.push((await publishScenarioFixture(creator, content)).id);
    }
    const draft = validContent();
    draft.source.player = playerName;
    draft.title = `${playerName} unpublished scenario`;
    draftId = (await createDraftFixture(creator, draft)).id;
    const preview = await api<LibraryScenarioPreview>(
      null,
      `/api/library/scenarios/${publishedIds[0]}`,
    );
    expect(preview.response.status).toBe(200);
    playerId = preview.data.player.id;
  });

  afterAll(async () => {
    await cleanupTestUsers(users);
  });

  it("exposes only published counts and setup previews to guests and DB-unverified accounts", async () => {
    for (const browser of [null, unverified]) {
      const groups = await api<PlayerListResponse>(
        browser,
        `/api/library/players?${new URLSearchParams({ query: playerName })}`,
      );
      expect(groups.response.status).toBe(200);
      expect(groups.data.players).toHaveLength(1);
      const group = groups.data.players[0];
      expect(group.player).toEqual({ id: playerId, displayName: playerName });
      expect(group.scenarioCount).toBe(4);
      expect(group.scenarios).toHaveLength(3);
      for (const preview of group.scenarios) {
        expect(publishedIds).toContain(preview.id);
        expectSafePreview(preview);
      }
      const listing = await api<LibraryListResponse>(
        browser,
        `/api/library/scenarios?playerId=${playerId}`,
      );
      expect(listing.response.status).toBe(200);
      expect(listing.data.scenarios.map((item) => item.id).sort()).toEqual(
        [...publishedIds].sort(),
      );
      expect(listing.data.nextCursor).toBeNull();
      for (const preview of listing.data.scenarios) expectSafePreview(preview);
      expect(
        (await api(browser, `/api/library/scenarios/${draftId}`)).response
          .status,
      ).toBe(404);
    }
    const denied = await api<ApiErrorResponse>(unverified, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "scenario", scenarioId: demos[0].id },
    });
    expect(denied.response.status).toBe(403);
    expect(denied.data.error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(
      (
        await api(null, "/api/sessions", {
          requestId: randomUUID(),
          target: { kind: "scenario", scenarioId: demos[0].id },
        })
      ).response.status,
    ).toBe(401);
  });

  it("serves all original scenario slugs with explicit curated AI attribution", async () => {
    expect(demos).toHaveLength(3);
    const filteredIds = new Set<string>(),
      cursors = new Set<string>();
    let nextCursor: string | null = null;
    // Other suites retain published TenZ fixtures; the curated scenarios can be
    // beyond the first page, so follow the actual public pagination contract.
    do {
      const params = new URLSearchParams({ playerId: TENZ_PLAYER_ID });
      if (nextCursor) params.set("cursor", nextCursor);
      const filtered = await api<LibraryListResponse>(
        null,
        `/api/library/scenarios?${params}`,
      );
      expect(filtered.response.status).toBe(200);
      filtered.data.scenarios.forEach((item) => filteredIds.add(item.id));
      nextCursor = filtered.data.nextCursor;
      if (nextCursor) {
        expect(cursors.has(nextCursor)).toBe(false);
        cursors.add(nextCursor);
      }
    } while (nextCursor);
    for (const seed of demos) {
      const detail = await api<LibraryScenarioPreview>(
        null,
        `/api/library/scenarios/${seed.id}`,
      );
      expect(detail.response.status).toBe(200);
      expect(detail.data).toMatchObject({
        id: seed.id,
        player: { id: TENZ_PLAYER_ID, displayName: "TenZ" },
        editorialOrigin: "curated",
        provenance: "ai",
        publishedAt: null,
      });
      expectSafePreview(detail.data);
      expect(filteredIds.has(seed.id)).toBe(true);
      const view = await page(null, `/library/${seed.id}`);
      expect(view.response.status).toBe(200);
      expect(view.html).toContain(seed.title);
      expect(view.html).toContain("Curated · AI-authored analysis");
      expect(view.html).toContain(
        `href="/sign-in?returnTo=${encodeURIComponent(`/library/${seed.id}`)}"`,
      );
      expect(view.html).not.toContain(seed.outcomeText);
    }
  });

  it("returns unavailable pages for missing or malformed players and scenarios", async () => {
    for (const path of [
      `/library/players/${randomUUID()}`,
      "/library/players/not-a-player",
      `/library/${randomUUID()}`,
      "/library/missing-editorial-scenario",
    ])
      expectUnavailable(await page(null, path));
  });

  it("keeps old entry routes as reads and never starts sessions on GET", async () => {
    expectRedirect(
      await page(null, "/demo"),
      `/library/players/${TENZ_PLAYER_ID}`,
    );
    expectRedirect(await page(null, "/play"), "/library");
    const before = await api<SessionHistoryResponse>(
      emptyLearner,
      "/api/sessions",
    );
    expect(before.data.sessions).toEqual([]);
    for (const path of [
      "/",
      "/library",
      `/library/players/${TENZ_PLAYER_ID}`,
      `/library/${demos[0].id}`,
    ])
      expect((await page(emptyLearner, path)).response.status).toBe(200);
    expectRedirect(
      await page(emptyLearner, "/demo"),
      `/library/players/${TENZ_PLAYER_ID}`,
    );
    expectRedirect(await page(emptyLearner, "/play"), "/library");
    const after = await api<SessionHistoryResponse>(
      emptyLearner,
      "/api/sessions",
    );
    expect(after.data.sessions).toEqual([]);
    const count = await createLocalTestClient("admin")
      .from("training_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", unverifiedUser.id);
    expect(count.error).toBeNull();
    expect(count.count).toBe(0);
  });

  it("preserves the exact selected scenario across sign-in, sign-up and verification forms", async () => {
    const returnTo = `/library/${demos[0].id}`;
    for (const route of ["/sign-in", "/sign-up", "/check-email"]) {
      const view = await page(
        null,
        `${route}?returnTo=${encodeURIComponent(returnTo)}`,
      );
      expect(view.response.status).toBe(200);
      const hidden =
        view.html.match(
          /<input\b(?=[^>]*type="hidden")(?=[^>]*name="returnTo")[^>]*>/g,
        ) ?? [];
      expect(hidden).toHaveLength(1);
      expect(hidden[0]).toContain(`value="${returnTo}"`);
      const destinations =
        route === "/sign-in" ? ["/sign-up", "/check-email"] : ["/sign-in"];
      for (const destination of destinations)
        expect(view.html).toContain(
          `href="${destination}?returnTo=${encodeURIComponent(returnTo)}"`,
        );
    }
  });

  it.each(
    demos.map((seed, index) => ({ id: seed.id, title: seed.title, index })),
  )(
    "starts only $id and resumes the same owned session through /play",
    async ({ id, title, index }) => {
      const browser = seedBrowsers[index];
      const start = await api<CreateSessionResponse>(browser, "/api/sessions", {
        requestId: randomUUID(),
        target: { kind: "scenario", scenarioId: id },
      });
      expect(start.response.status).toBe(200);
      expect(start.data.created).toBe(true);
      const session = start.data.session;
      expect(session).toMatchObject({
        target: { kind: "scenario", scenarioId: id },
        title,
        phase: "setup",
        revision: 0,
      });
      expect(session.items).toHaveLength(1);
      expect(session.items[0].challenge.id).toBe(id);
      expect(session.items[0].answer).toBeNull();
      expectRedirect(await page(browser, "/play"), `/play/${session.id}`);
      const history = await api<SessionHistoryResponse>(
        browser,
        "/api/sessions",
      );
      expect(history.data.sessions).toHaveLength(1);
      expect(history.data.sessions[0]).toMatchObject({
        id: session.id,
        totalCount: 1,
        answeredCount: 0,
      });
      expectRedirect(await page(emptyLearner, "/play"), "/library");
      expect(
        (await api(emptyLearner, `/api/sessions/${session.id}`)).response
          .status,
      ).toBe(404);
    },
  );

  it("binds valid player and scenario cursors to their original filters", async () => {
    const playersCursor = cursor({
      v: 1,
      kind: "players",
      query: "tenz",
      id: TENZ_PLAYER_ID,
    });
    expect(
      (
        await api(
          null,
          `/api/library/players?${new URLSearchParams({ query: "TenZ", cursor: playersCursor })}`,
        )
      ).response.status,
    ).toBe(200);
    const scenarioCursor = cursor({
      v: 1,
      kind: "scenarios",
      playerId: TENZ_PLAYER_ID,
      at: "2099-01-01T00:00:00.000Z",
      id: demos[0].id,
    });
    const accepted = await api<LibraryListResponse>(
      null,
      `/api/library/scenarios?${new URLSearchParams({ playerId: TENZ_PLAYER_ID, cursor: scenarioCursor })}`,
    );
    expect(accepted.response.status).toBe(200);
    expect(
      accepted.data.scenarios.every(
        (item) => item.player.id === TENZ_PLAYER_ID,
      ),
    ).toBe(true);
    for (const path of [
      `/api/library/players?${new URLSearchParams({ query: playerName, cursor: playersCursor })}`,
      `/api/library/scenarios?${new URLSearchParams({ playerId, cursor: scenarioCursor })}`,
      `/api/library/scenarios?${new URLSearchParams({ cursor: scenarioCursor })}`,
    ]) {
      const rejected = await api<ApiErrorResponse>(null, path);
      expect(rejected.response.status).toBe(400);
      expect(rejected.data.error.code).toBe("INVALID_REQUEST");
    }
  });
});
