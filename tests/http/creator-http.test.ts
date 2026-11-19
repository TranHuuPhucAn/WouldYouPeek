import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ApiErrorResponse } from "@/contracts/challenge";
import type {
  CreatorDraftContent,
  CreatorListResponse,
  CreatorMutationResponse,
  CreatorReviewPreview,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import type {
  CreateSessionResponse,
  SessionHistoryResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import {
  checklist,
  validContent,
} from "../integration/helpers/creator-scenarios";
import {
  createVerifiedTestUser,
  type TestUser,
} from "../integration/helpers/test-users";
import { api, appOrigin, loginBrowser, type Browser } from "./helpers/browser";

describe("creator publication and selected learning through real Next HTTP routes", () => {
  let creator: Browser, learner: Browser, other: Browser;
  let learnerUser: TestUser,
    scenario: CreatorScenarioSnapshot,
    session: SessionSnapshot;
  let publishBody: {
    requestId: string;
    expectedRevision: number;
    reviewId: string;
  };
  const createId = randomUUID();
  const endpoint = () => `/api/creator/scenarios/${scenario.id}`;

  beforeAll(async () => {
    appOrigin();
    learnerUser = await createVerifiedTestUser();
    const [ownerUser, otherUser] = await Promise.all([
      createVerifiedTestUser(),
      createVerifiedTestUser(),
    ]);
    [creator, learner, other] = await Promise.all([
      loginBrowser(ownerUser),
      loginBrowser(learnerUser),
      loginBrowser(otherUser),
    ]);
    for (const browser of [creator, other])
      expect(
        (await api(browser, "/api/account/creator", {})).response.status,
      ).toBe(200);
  });
  // Published fixtures are intentionally retained within the owned disposable
  // project; stack disposal removes them without weakening immutable-history rules.

  async function save(content: CreatorDraftContent) {
    const result = await api<CreatorMutationResponse>(
      creator,
      endpoint(),
      { requestId: randomUUID(), expectedRevision: scenario.revision, content },
      { method: "PUT" },
    );
    expect(result.response.status).toBe(200);
    scenario = result.data.scenario;
    return result;
  }
  async function review() {
    const result = await api<CreatorMutationResponse>(
      creator,
      `${endpoint()}/review`,
      {
        requestId: randomUUID(),
        expectedRevision: scenario.revision,
        checklist: checklist(),
      },
    );
    expect(result.response.status).toBe(200);
    scenario = result.data.scenario;
  }

  it("requires verified creator identity and keeps missing/foreign drafts indistinguishable", async () => {
    expect((await api(null, "/api/creator/scenarios")).response.status).toBe(
      401,
    );
    expect((await api(learner, "/api/creator/scenarios")).response.status).toBe(
      403,
    );
    expect((await api(null, "/api/library/scenarios")).response.status).toBe(
      401,
    );
    const created = await api<CreatorMutationResponse>(
      creator,
      "/api/creator/scenarios",
      { requestId: createId },
    );
    expect(created.response.status).toBe(200);
    scenario = created.data.scenario;
    expect(scenario.readiness.canReview).toBe(false);
    expect(
      (
        await api<CreatorMutationResponse>(creator, "/api/creator/scenarios", {
          requestId: createId,
        })
      ).data,
    ).toMatchObject({ replayed: true, scenario: { id: scenario.id } });
    const foreign = await api(other, endpoint());
    const missing = await api(other, `/api/creator/scenarios/${randomUUID()}`);
    expect(foreign.response.status).toBe(404);
    expect(foreign.data).toEqual(missing.data);
    expect(
      (
        await api(
          other,
          endpoint(),
          {
            requestId: randomUUID(),
            expectedRevision: scenario.revision,
            content: validContent(),
          },
          { method: "PUT" },
        )
      ).response.status,
    ).toBe(404);
  });

  it("saves canonical content, previews without learner history, and reviews an exact saved revision", async () => {
    const content = validContent();
    content.title = `  HTTP creator scenario ${randomUUID()}  `;
    await save(content);
    expect(scenario.draft.content.title).toBe(content.title.trim());
    expect(scenario.readiness).toEqual({ canReview: true, issues: [] });
    const preview = await api<CreatorReviewPreview>(
      creator,
      `${endpoint()}/review?revision=${scenario.revision}`,
    );
    expect(preview.response.status).toBe(200);
    expect(preview.data.challenge.id).toBe(scenario.id);
    expect(Object.keys(preview.data.feedbackByOption)).toHaveLength(
      content.options.length,
    );
    expect(
      (await api<SessionHistoryResponse>(creator, "/api/sessions")).data
        .sessions,
    ).toEqual([]);
    const oldRevision = scenario.revision;
    await review();
    const reviewId = scenario.review!.id,
      draftRevision = scenario.draft.revision;
    await save(scenario.draft.content);
    expect(scenario.review?.id).toBe(reviewId);
    expect(scenario.draft.revision).toBe(draftRevision);
    expect(
      (await api(creator, `${endpoint()}/review?revision=${oldRevision}`))
        .response.status,
    ).toBe(409);
    const listing = await api<CreatorListResponse>(
      creator,
      "/api/creator/scenarios?status=unpublished",
    );
    expect(listing.data.scenarios.map((s) => s.id)).toContain(scenario.id);
  });

  it("publishes safe library metadata and starts only the selected pinned scenario", async () => {
    publishBody = {
      requestId: randomUUID(),
      expectedRevision: scenario.revision,
      reviewId: scenario.review!.id,
    };
    const published = await api<CreatorMutationResponse>(
      creator,
      `${endpoint()}/publish`,
      publishBody,
    );
    expect(published.response.status).toBe(200);
    scenario = published.data.scenario;
    expect(published.data.publishedVersion).toBe("creator-1");
    expect(
      (await api(null, `/api/challenges/${scenario.id}`)).response.status,
    ).toBe(404);
    const preview = await api<LibraryScenarioPreview>(
      learner,
      `/api/library/scenarios/${scenario.id}`,
    );
    expect(preview.response.status).toBe(200);
    expect(preview.data).toMatchObject({
      id: scenario.id,
      provenance: "creator",
    });
    for (const field of [
      "question",
      "options",
      "analysis",
      "observedAction",
      "reveal",
      "ownerId",
      "email",
    ])
      expect(preview.data).not.toHaveProperty(field);
    const list = await api<LibraryListResponse>(
      learner,
      "/api/library/scenarios",
    );
    expect(list.data.scenarios.map((s) => s.id)).toContain(scenario.id);
    const started = await api<CreateSessionResponse>(learner, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "scenario", scenarioId: scenario.id },
    });
    expect(started.response.status).toBe(200);
    session = started.data.session;
    expect(session).toMatchObject({
      target: { kind: "scenario", scenarioId: scenario.id },
      title: scenario.draft.content.title,
      phase: "setup",
    });
    expect(session.items).toHaveLength(1);
    expect(session.items[0].challenge.contentVersion).toBe("creator-1");
    expect(session.items[0].answer).toBeNull();
    const conflict = await api<ApiErrorResponse>(learner, "/api/sessions", {
      requestId: randomUUID(),
      target: { kind: "demo" },
    });
    expect(conflict.response.status).toBe(409);
    expect(conflict.data.error).toMatchObject({
      code: "ACTIVE_SESSION_EXISTS",
      details: { activeSession: { id: session.id, totalCount: 1 } },
    });
    expect(JSON.stringify(conflict.data)).not.toContain("observedAction");
  });

  it("keeps a pinned learner version while later edits are reviewed and published", async () => {
    const content = structuredClone(scenario.draft.content);
    content.question = "Updated creator question for version two";
    content.analysis.author = "ai-assisted";
    await save(content);
    expect(scenario.review).toBeNull();
    expect(
      (
        await api(creator, `${endpoint()}/publish`, {
          requestId: randomUUID(),
          expectedRevision: scenario.revision,
          reviewId: publishBody.reviewId,
        })
      ).response.status,
    ).toBe(409);
    await review();
    const published = await api<CreatorMutationResponse>(
      creator,
      `${endpoint()}/publish`,
      {
        requestId: randomUUID(),
        expectedRevision: scenario.revision,
        reviewId: scenario.review!.id,
      },
    );
    expect(published.response.status).toBe(200);
    scenario = published.data.scenario;
    expect(scenario.publication.currentVersion).toBe("creator-2");
    expect(
      (await api<SessionSnapshot>(learner, `/api/sessions/${session.id}`)).data
        .items[0].challenge.question,
    ).toBe(session.items[0].challenge.question);
    const replay = await api<CreatorMutationResponse>(
      creator,
      `${endpoint()}/publish`,
      publishBody,
    );
    expect(replay.data).toMatchObject({
      replayed: true,
      publishedVersion: "creator-1",
      scenario: { publication: { currentVersion: "creator-2" } },
    });
  });

  it("withdraws new availability while old sessions reveal, finish, and reload from history", async () => {
    const withdrawn = await api<CreatorMutationResponse>(
      creator,
      `${endpoint()}/unpublish`,
      { requestId: randomUUID(), expectedRevision: scenario.revision },
    );
    expect(withdrawn.response.status).toBe(200);
    scenario = withdrawn.data.scenario;
    expect(scenario.review).toBeNull();
    expect(
      (await api(learner, `/api/library/scenarios/${scenario.id}`)).response
        .status,
    ).toBe(404);
    expect(
      (
        await api(other, "/api/sessions", {
          requestId: randomUUID(),
          target: { kind: "scenario", scenarioId: scenario.id },
        })
      ).response.status,
    ).toBe(404);
    const item = session.items[0];
    const answered = await api<SessionMutationResponse>(
      learner,
      `/api/sessions/${session.id}/items/${item.id}/answer`,
      {
        requestId: randomUUID(),
        expectedRevision: session.revision,
        optionId: item.challenge.options[0].id,
      },
    );
    expect(answered.response.status).toBe(200);
    session = answered.data.session;
    expect(session.phase).toBe("review");
    expect(session.items[0].answer?.result.analysis?.author).toBe("creator");
    const finished = await api<SessionMutationResponse>(
      learner,
      `/api/sessions/${session.id}/advance`,
      {
        requestId: randomUUID(),
        expectedRevision: session.revision,
        fromItemId: item.id,
      },
    );
    expect(finished.response.status).toBe(200);
    session = finished.data.session;
    expect(session).toMatchObject({ phase: "completed", revision: 2 });
    const fresh = await loginBrowser(learnerUser);
    expect(
      (await api<SessionSnapshot>(fresh, `/api/sessions/${session.id}`)).data,
    ).toEqual(session);
    expect(
      (await api<SessionHistoryResponse>(fresh, "/api/sessions")).data.sessions,
    ).toContainEqual(
      expect.objectContaining({
        id: session.id,
        title: session.title,
        totalCount: 1,
        status: "completed",
      }),
    );
  });

  it("rejects oversized, malformed, unsupported, and cross-origin writes without changing saved state", async () => {
    const before = scenario.revision;
    const request = {
      requestId: randomUUID(),
      expectedRevision: before,
      content: scenario.draft.content,
    };
    const badRequests: NonNullable<Parameters<typeof api>[3]>[] = [
      { method: "PUT", headers: { Origin: "https://other.example" } },
      { method: "PUT", headers: { "Content-Type": "text/plain" } },
      { method: "PUT", rawBody: "{" },
    ];
    for (const options of badRequests)
      expect(
        (await api(creator, endpoint(), request, options)).response.status,
      ).toBe(400);
    const tooLarge = await api<ApiErrorResponse>(
      creator,
      endpoint(),
      undefined,
      {
        method: "PUT",
        rawBody: JSON.stringify({ padding: "🙂".repeat(18_000) }),
      },
    );
    expect(tooLarge.response.status).toBe(413);
    expect(tooLarge.data.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(
      (
        await api(
          creator,
          endpoint(),
          { ...request, ownerId: randomUUID() },
          { method: "PUT" },
        )
      ).response.status,
    ).toBe(400);
    for (const path of [
      "/api/creator/scenarios?status=all&status=published",
      "/api/creator/scenarios?limit=1000",
      "/api/library/scenarios?cursor=garbage",
      `${endpoint()}/review?revision=01`,
    ])
      expect((await api(creator, path)).response.status).toBe(400);
    expect(
      (await api<CreatorScenarioSnapshot>(creator, endpoint())).data.revision,
    ).toBe(before);
  });
});
