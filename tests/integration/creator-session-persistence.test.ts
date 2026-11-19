import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  CreatorMutationResponse,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";
import type {
  CreateSessionResponse,
  SessionSnapshot,
} from "@/contracts/session";
import type { LibraryListResponse } from "@/contracts/library";
import { createVerifiedTestUser, type TestUser } from "./helpers/test-users";
import {
  createVerifiedCreator,
  finishSession,
  publishScenarioFixture,
  race,
  reviewDraftFixture,
  rpc,
  saveDraftFixture,
  startSingle,
  validContent,
} from "./helpers/creator-scenarios";

describe("creator publication and saved learner session boundaries", () => {
  let creator: TestUser;
  beforeAll(async () => {
    creator = await createVerifiedCreator();
  });
  it("pins old content and feedback across updates and ordinary withdrawal", async () => {
    let scenario = await publishScenarioFixture(creator);
    const learner = await createVerifiedTestUser(),
      other = await createVerifiedTestUser(),
      newcomer = await createVerifiedTestUser();
    const old = await startSingle(learner, scenario.id);
    expect(old.items).toHaveLength(1);
    expect(old.target).toEqual({ kind: "scenario", scenarioId: scenario.id });
    const firstQuestion = old.items[0].challenge.question;
    scenario = await saveDraftFixture(creator, scenario, {
      ...scenario.draft.content,
      question: "What changes when you wait for support?",
      analysis: { ...scenario.draft.content.analysis, author: "ai-assisted" },
    });
    scenario = await reviewDraftFixture(creator, scenario);
    scenario = (
      await rpc<CreatorMutationResponse>(
        creator.client,
        "publish_creator_scenario",
        {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
          p_review_id: scenario.review!.id,
        },
      )
    ).scenario;
    const latest = await startSingle(other, scenario.id);
    expect(latest.items[0].challenge.contentVersion).toBe("creator-2");
    expect(latest.items[0].challenge.question).not.toBe(firstQuestion);
    const preserved = await rpc<SessionSnapshot>(
      learner.client,
      "get_training_session",
      { p_session_id: old.id },
    );
    expect(preserved.items[0].challenge.question).toBe(firstQuestion);
    expect(preserved.items[0].challenge.contentVersion).toBe("creator-1");
    const withdrawn = await rpc<CreatorMutationResponse>(
      creator.client,
      "unpublish_creator_scenario",
      {
        p_scenario_id: scenario.id,
        p_request_id: randomUUID(),
        p_expected_revision: scenario.revision,
      },
    );
    expect(withdrawn.scenario.publication.state).toBe("withdrawn");
    expect(withdrawn.scenario.review).toBeNull();
    const denied = await newcomer.client.rpc(
      "start_selected_training_session",
      {
        p_request_id: randomUUID(),
        p_target: { kind: "scenario", scenarioId: scenario.id },
      },
    );
    expect(denied.error?.message).toBe("SCENARIO_UNAVAILABLE");
    const resumed = await startSingle(learner, scenario.id);
    expect(resumed.id).toBe(old.id);
    const complete = await finishSession(learner, resumed);
    expect(complete.items[0].answer?.result.analysis?.author).toBe("creator");
    const otherComplete = await finishSession(other, latest);
    expect(otherComplete.items[0].answer?.result.analysis?.author).toBe(
      "ai-assisted",
    );
    const saved = await rpc<SessionSnapshot>(
      learner.client,
      "get_training_session",
      { p_session_id: complete.id },
    );
    expect(saved).toEqual(complete);
    const rereviewed = await reviewDraftFixture(creator, withdrawn.scenario);
    const restored = await rpc<CreatorMutationResponse>(
      creator.client,
      "publish_creator_scenario",
      {
        p_scenario_id: scenario.id,
        p_request_id: randomUUID(),
        p_expected_revision: rereviewed.revision,
        p_review_id: rereviewed.review!.id,
      },
    );
    expect(restored.publishedVersion).toBe("creator-2");
    expect(
      (await startSingle(newcomer, scenario.id)).items[0].challenge
        .contentVersion,
    ).toBe("creator-2");
  });
  it("keeps the demo at three items and requires an explicit existing-session choice", async () => {
    const scenario = await publishScenarioFixture(creator),
      learner = await createVerifiedTestUser(),
      requestId = randomUUID();
    const demo = await rpc<CreateSessionResponse>(
      learner.client,
      "start_training_session",
      { p_request_id: requestId },
    );
    expect(demo.session.items).toHaveLength(3);
    expect(demo.session.target).toEqual({ kind: "demo" });
    const conflict = await learner.client.rpc(
      "start_selected_training_session",
      {
        p_request_id: randomUUID(),
        p_target: { kind: "scenario", scenarioId: scenario.id },
      },
    );
    expect(conflict.error?.message).toBe("ACTIVE_SESSION_EXISTS");
    const details = JSON.parse(conflict.error!.details);
    expect(details.activeSession.id).toBe(demo.session.id);
    expect(details.activeSession).not.toHaveProperty("items");
    await finishSession(learner, demo.session);
    const replay = await rpc<CreateSessionResponse>(
      learner.client,
      "start_training_session",
      { p_request_id: requestId },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.session.phase).toBe("completed");
    expect(replay.session.id).toBe(demo.session.id);
    const reused = await learner.client.rpc("start_selected_training_session", {
      p_request_id: requestId,
      p_target: { kind: "scenario", scenarioId: scenario.id },
    });
    expect(reused.error?.message).toBe("IDEMPOTENCY_CONFLICT");
    expect((await startSingle(learner, scenario.id)).items).toHaveLength(1);
  });
  it("defines a serial outcome for a simultaneous start and withdrawal", async () => {
    const scenario = await publishScenarioFixture(creator),
      learner = await createVerifiedTestUser();
    const [start, withdraw] = await race(
      () =>
        learner.client.rpc("start_selected_training_session", {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: scenario.id },
        }),
      () =>
        creator.client.rpc("unpublish_creator_scenario", {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
        }),
    );
    expect(withdraw.error).toBeNull();
    if (start.error) expect(start.error.message).toBe("SCENARIO_UNAVAILABLE");
    else {
      const pinned = (start.data as CreateSessionResponse).session;
      expect((await finishSession(learner, pinned)).phase).toBe("completed");
    }
  });
  it("continues library pagination after the cursor anchor is withdrawn", async () => {
    const owned: CreatorScenarioSnapshot[] = [];
    for (let i = 0; i < 3; i++)
      owned.push(
        await publishScenarioFixture(creator, {
          ...validContent(),
          title: `Cursor scenario ${i}`,
        }),
      );
    const learner = await createVerifiedTestUser();
    const first = await rpc<LibraryListResponse>(
      learner.client,
      "list_library_previews",
      { p_limit: 1 },
    );
    const anchor = owned.find((s) => s.id === first.scenarios[0].id);
    expect(anchor).toBeDefined();
    expect(first.nextCursor).not.toBeNull();
    const withdrawn = await rpc<CreatorMutationResponse>(
      creator.client,
      "unpublish_creator_scenario",
      {
        p_scenario_id: anchor!.id,
        p_request_id: randomUUID(),
        p_expected_revision: anchor!.revision,
      },
    );
    const next = await rpc<LibraryListResponse>(
      learner.client,
      "list_library_previews",
      { p_limit: 1, p_cursor: first.nextCursor! },
    );
    expect(next.scenarios).toHaveLength(1);
    expect(next.scenarios[0].id).not.toBe(anchor!.id);
    const all = await rpc<LibraryListResponse>(
      learner.client,
      "list_library_previews",
      { p_limit: 50 },
    );
    expect(all.scenarios.some((s) => s.id === anchor!.id)).toBe(false);
    const reviewed = await reviewDraftFixture(creator, withdrawn.scenario);
    const restored = await rpc<CreatorMutationResponse>(
      creator.client,
      "publish_creator_scenario",
      {
        p_scenario_id: reviewed.id,
        p_request_id: randomUUID(),
        p_expected_revision: reviewed.revision,
        p_review_id: reviewed.review!.id,
      },
    );
    expect(restored.publishedVersion).toBe(anchor!.publication.currentVersion);
    const afterRestore = await rpc<LibraryListResponse>(
      learner.client,
      "list_library_previews",
      {
        p_limit: 1,
        p_cursor: first.nextCursor!,
      },
    );
    expect(afterRestore.scenarios.map((s) => s.id)).toEqual(
      next.scenarios.map((s) => s.id),
    );
    expect(afterRestore.nextCursor).toBe(next.nextCursor);
  });
});
