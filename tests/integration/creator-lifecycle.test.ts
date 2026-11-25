import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  CreatorMutationResponse,
  CreatorScenarioSnapshot,
  CreatorReviewPreview,
  CreatorListResponse,
} from "@/contracts/creator";
import type { SessionHistoryResponse } from "@/contracts/session";
import type { TestUser } from "./helpers/test-users";
import { fixtureSql, sqlLiteral } from "./helpers/database";
import {
  checklist,
  createDraftFixture,
  createVerifiedCreator,
  independentClient,
  race,
  reviewDraftFixture,
  rpc,
  saveDraftFixture,
  validContent,
} from "./helpers/creator-scenarios";
import vectors from "../fixtures/creator-content-cases.json";

describe("creator draft, review and atomic publication", () => {
  let owner: TestUser;
  beforeAll(async () => {
    owner = await createVerifiedCreator();
  });
  it("preserves no-op review, invalidates actual edits and pins reviews to saved content", async () => {
    let draft = await createDraftFixture(owner);
    const preview = await rpc<CreatorReviewPreview>(
      owner.client,
      "get_creator_review_preview",
      { p_scenario_id: draft.id, p_revision: draft.revision },
    );
    expect(preview.challenge.id).toBe(draft.id);
    expect(Object.keys(preview.feedbackByOption)).toHaveLength(
      draft.draft.content.options.length,
    );
    for (const [optionId, answer] of Object.entries(preview.feedbackByOption)) {
      expect(answer.selectedOptionId).toBe(optionId);
      expect(answer.analysis?.author).toBe("creator");
    }
    const history = await rpc<SessionHistoryResponse>(
      owner.client,
      "list_training_sessions",
    );
    expect(history.sessions).toHaveLength(0);
    draft = await reviewDraftFixture(owner, draft);
    const receipt = draft.review!.id;
    const noOp = await saveDraftFixture(owner, draft, draft.draft.content);
    expect(noOp.draft.revision).toBe(draft.draft.revision);
    expect(noOp.review?.id).toBe(receipt);
    const changed = {
      ...noOp.draft.content,
      question: "What is defensible with the same information?",
    };
    const edited = await saveDraftFixture(owner, noOp, changed);
    expect(edited.review).toBeNull();
    expect(edited.draft.revision).toBe(draft.draft.revision + 1);
    expect(
      (
        await owner.client.rpc("publish_creator_scenario", {
          p_scenario_id: draft.id,
          p_request_id: randomUUID(),
          p_expected_revision: edited.revision,
          p_review_id: receipt,
        })
      ).error?.message,
    ).toBe("REVIEW_REQUIRED");
    expect(
      (
        await owner.client.rpc("get_creator_review_preview", {
          p_scenario_id: draft.id,
          p_revision: noOp.revision,
        })
      ).error?.message,
    ).toBe("SCENARIO_CONFLICT");
  });
  it("replays the original command before checking a stale revision without publishing twice", async () => {
    let draft = await reviewDraftFixture(
      owner,
      await createDraftFixture(owner),
    );
    const command = {
      p_scenario_id: draft.id,
      p_request_id: randomUUID(),
      p_expected_revision: draft.revision,
      p_review_id: draft.review!.id,
    };
    const secondClient = await independentClient(owner);
    const duplicates = await race(
      () => owner.client.rpc("publish_creator_scenario", command),
      () => secondClient.rpc("publish_creator_scenario", command),
    );
    expect(duplicates.every((result) => result.error === null)).toBe(true);
    expect(duplicates.map((result) => result.data.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const first = duplicates.find((result) => !result.data.replayed)!
      .data as CreatorMutationResponse;
    expect(first.publishedVersion).toBe("creator-1");
    expect(first.replayed).toBe(false);
    const replay = await rpc<CreatorMutationResponse>(
      owner.client,
      "publish_creator_scenario",
      command,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.scenario.revision).toBe(first.scenario.revision);
    expect(
      (
        await owner.client.rpc("publish_creator_scenario", {
          ...command,
          p_review_id: randomUUID(),
        })
      ).error?.message,
    ).toBe("IDEMPOTENCY_CONFLICT");
    draft = await saveDraftFixture(owner, first.scenario, {
      ...first.scenario.draft.content,
      title: "A later version",
    });
    draft = await reviewDraftFixture(owner, draft);
    const second = await rpc<CreatorMutationResponse>(
      owner.client,
      "publish_creator_scenario",
      {
        p_scenario_id: draft.id,
        p_request_id: randomUUID(),
        p_expected_revision: draft.revision,
        p_review_id: draft.review!.id,
      },
    );
    const delayed = await rpc<CreatorMutationResponse>(
      owner.client,
      "publish_creator_scenario",
      command,
    );
    expect(delayed.publishedVersion).toBe("creator-1");
    expect(delayed.scenario.publication.currentVersion).toBe(
      second.publishedVersion,
    );
    expect(second.publishedVersion).toBe("creator-2");
    const count = Number(
      fixtureSql(
        `select count(*) from public.scenario_versions where scenario_id=${sqlLiteral(draft.id)};`,
      ),
    );
    expect(count).toBe(2);
  });
  it("serializes duplicate creates and competing save/publish using independent clients", async () => {
    const second = await independentClient(owner);
    const p_request_id = randomUUID();
    const creates = await race(
      () => owner.client.rpc("create_creator_scenario", { p_request_id }),
      () => second.rpc("create_creator_scenario", { p_request_id }),
    );
    expect(creates.every((r) => !r.error)).toBe(true);
    expect(creates[0].data.scenario.id).toBe(creates[1].data.scenario.id);
    expect(creates.map((r) => r.data.replayed).sort()).toEqual([false, true]);
    const ready = await reviewDraftFixture(
      owner,
      await createDraftFixture(owner),
    );
    const results = await race(
      () =>
        owner.client.rpc("publish_creator_scenario", {
          p_scenario_id: ready.id,
          p_request_id: randomUUID(),
          p_expected_revision: ready.revision,
          p_review_id: ready.review!.id,
        }),
      () =>
        second.rpc("save_creator_scenario", {
          p_scenario_id: ready.id,
          p_request_id: randomUUID(),
          p_expected_revision: ready.revision,
          p_content: { ...ready.draft.content, question: "A concurrent edit" },
        }),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe(
      "SCENARIO_CONFLICT",
    );
    const canonical = await rpc<CreatorScenarioSnapshot>(
      owner.client,
      "get_creator_scenario",
      { p_scenario_id: ready.id },
    );
    expect(canonical.revision).toBe(ready.revision + 1);
    const versions = Number(
      fixtureSql(
        `select count(*) from public.scenario_versions where scenario_id=${sqlLiteral(ready.id)};`,
      ),
    );
    expect(versions).toBe(
      canonical.publication.state === "published" ? 1 : 0,
    );
  });
  it("serializes review/save and publish/withdraw with one accepted expected revision", async () => {
    const second = await independentClient(owner);
    let draft = await createDraftFixture(owner);
    const reviewed = await race(
      () =>
        owner.client.rpc("review_creator_scenario", {
          p_scenario_id: draft.id,
          p_request_id: randomUUID(),
          p_expected_revision: draft.revision,
          p_checklist: checklist(),
        }),
      () =>
        second.rpc("save_creator_scenario", {
          p_scenario_id: draft.id,
          p_request_id: randomUUID(),
          p_expected_revision: draft.revision,
          p_content: { ...draft.draft.content, title: "Concurrent title" },
        }),
    );
    expect(reviewed.filter((r) => !r.error)).toHaveLength(1);
    draft = await rpc<CreatorScenarioSnapshot>(
      owner.client,
      "get_creator_scenario",
      { p_scenario_id: draft.id },
    );
    if (!draft.review) draft = await reviewDraftFixture(owner, draft);
    const first = await rpc<CreatorMutationResponse>(
      owner.client,
      "publish_creator_scenario",
      {
        p_scenario_id: draft.id,
        p_request_id: randomUUID(),
        p_expected_revision: draft.revision,
        p_review_id: draft.review!.id,
      },
    );
    const current = first.scenario;
    const results = await race(
      () =>
        owner.client.rpc("publish_creator_scenario", {
          p_scenario_id: current.id,
          p_request_id: randomUUID(),
          p_expected_revision: current.revision,
          p_review_id: current.review!.id,
        }),
      () =>
        second.rpc("unpublish_creator_scenario", {
          p_scenario_id: current.id,
          p_request_id: randomUUID(),
          p_expected_revision: current.revision,
        }),
    );
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe(
      "SCENARIO_CONFLICT",
    );
  });
  it("agrees with shared structural and publication validation vectors through direct RPC", async () => {
    for (const test of vectors.cases) {
      const content = validContent() as unknown as Record<string, unknown>;
      const keys = test.path.split(".");
      let field = content;
      for (const key of keys.slice(0, -1))
        field = field[key] as Record<string, unknown>;
      field[keys.at(-1)!] = test.value;
      const created = await rpc<CreatorMutationResponse>(
        owner.client,
        "create_creator_scenario",
        { p_request_id: randomUUID() },
      );
      const saved = await owner.client.rpc("save_creator_scenario", {
        p_scenario_id: created.scenario.id,
        p_request_id: randomUUID(),
        p_expected_revision: created.scenario.revision,
        p_content: content,
      });
      expect(saved.error === null, `${test.name}: draft validity`).toBe(
        test.draftValid,
      );
      if (test.draftValid) {
        const snapshot = (saved.data as CreatorMutationResponse).scenario;
        expect(
          snapshot.readiness.canReview,
          `${test.name}: publication validity`,
        ).toBe(test.publishValid);
      }
    }
  });
  it("filters and paginates stable owner tuples without leaking other owners", async () => {
    const first = await rpc<CreatorListResponse>(
      owner.client,
      "list_creator_scenarios",
      { p_status: "unpublished", p_limit: 2 },
    );
    expect(first.scenarios).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const next = await rpc<CreatorListResponse>(
      owner.client,
      "list_creator_scenarios",
      { p_status: "unpublished", p_cursor: first.nextCursor!, p_limit: 2 },
    );
    expect(
      next.scenarios.every((s) => !first.scenarios.some((p) => p.id === s.id)),
    ).toBe(true);
    expect(
      (
        await owner.client.rpc("list_creator_scenarios", {
          p_status: "published",
          p_cursor: first.nextCursor!,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
    expect(
      (
        await owner.client.rpc("list_creator_scenarios", {
          p_status: "unpublished",
          p_limit: 500,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
  });
});
