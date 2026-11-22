import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REPORT_CATEGORIES,
  type ReportReceipt,
  type VisibilityResponse,
} from "@/contracts/moderation";
import type {
  CreatorMutationResponse,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";
import type { CreateSessionResponse } from "@/contracts/session";
import {
  createVerifiedCreator,
  independentClient,
  publishScenarioFixture,
  reviewDraftFixture,
  rpc,
  saveDraftFixture,
} from "./helpers/creator-scenarios";
import { createVerifiedTestUser } from "./helpers/test-users";
import {
  createPlaylist,
  publishArgs,
  publishPlaylist,
  raceBehindLock,
  reviewPlaylist,
  saveProfile,
  selected,
  startArgs,
} from "./helpers/playlists";
import {
  createOperator,
  moderationSql,
  publicationTarget,
  reportArgs,
  revokeOperatorAsync,
  sqlLiteral,
  visibilityArgs,
} from "./helpers/moderation";

describe("moderation transactions behind observed PostgreSQL locks", () => {
  it("serializes duplicate reports into one row without duplicate quota consumption", async () => {
    const learner = await createVerifiedTestUser(),
      second = await independentClient(learner);
    const input = reportArgs(
      await publicationTarget("bind-clove-utility-window"),
    );
    const results = await raceBehindLock(`moderation:${learner.id}`, 9, [
      () => learner.client.rpc("create_scenario_report", input),
      () =>
        second.rpc("create_scenario_report", {
          ...input,
          p_request_id: randomUUID(),
        }),
    ]);
    results.forEach((result) => expect(result.error).toBeNull());
    const receipts = results.map((result) => result.data as ReportReceipt);
    expect(new Set(receipts.map((receipt) => receipt.report.id)).size).toBe(1);
    expect(receipts.map((receipt) => receipt.duplicate).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      Number(
        moderationSql(
          `select count(*) from private.scenario_reports where reporter_id=${sqlLiteral(learner.id)};`,
        ),
      ),
    ).toBe(1);
  });

  it("serializes repeated hide commands without advancing the availability generation twice", async () => {
    const owner = await createVerifiedCreator(),
      operator = await createOperator(),
      second = await independentClient(operator);
    const scenario = await publishScenarioFixture(owner),
      input = visibilityArgs(scenario.id, 0);
    const results = await raceBehindLock(`moderation:${operator.id}`, 9, [
      () => operator.client.rpc("set_operator_scenario_visibility", input),
      () => second.rpc("set_operator_scenario_visibility", input),
    ]);
    results.forEach((result) => expect(result.error).toBeNull());
    expect(
      results
        .map((result) => (result.data as VisibilityResponse).replayed)
        .sort(),
    ).toEqual([false, true]);
    expect(
      Number(
        moderationSql(
          `select generation from private.scenario_availability_fences where scenario_id=${sqlLiteral(scenario.id)};`,
        ),
      ),
    ).toBe(1);
  });

  it("enforces the account quota atomically across competing distinct reports", async () => {
    const learner = await createVerifiedTestUser(),
      target = await publicationTarget("bind-clove-utility-window");
    const results = await raceBehindLock(
      `moderation:${learner.id}`,
      9,
      REPORT_CATEGORIES.map(
        (category) => () =>
          learner.client.rpc(
            "create_scenario_report",
            reportArgs(target, category, "Concurrent distinct report"),
          ),
      ),
    );
    expect(results.filter((result) => result.error === null)).toHaveLength(5);
    expect(
      results
        .filter((result) => result.error !== null)
        .map((result) => result.error?.message),
    ).toEqual(["RATE_LIMITED"]);
    expect(
      Number(
        moderationSql(
          `select count(*) from private.scenario_reports where reporter_id=${sqlLiteral(learner.id)};`,
        ),
      ),
    ).toBe(5);
  });

  it("admits a complete playlist before hide or rejects it afterward, and blocks every later start", async () => {
    const owner = await createVerifiedCreator(),
      operator = await createOperator(),
      learner = await createVerifiedTestUser(),
      later = await createVerifiedTestUser();
    await saveProfile(owner);
    const one = await publishScenarioFixture(owner),
      two = await publishScenarioFixture(owner);
    const playlist = await publishPlaylist(owner, [
      selected(one),
      selected(two),
    ]);
    const [started, hidden] = await raceBehindLock(`scenario:${one.id}`, 2, [
      () =>
        learner.client.rpc(
          "start_playlist_training_session",
          startArgs(playlist),
        ),
      () =>
        operator.client.rpc(
          "set_operator_scenario_visibility",
          visibilityArgs(one.id, 0),
        ),
    ]);
    expect(hidden.error).toBeNull();
    if (started.error)
      expect(started.error.message).toBe("PLAYLIST_UNAVAILABLE");
    else {
      const snapshot = (started.data as CreateSessionResponse).session;
      expect(snapshot.items).toHaveLength(2);
      expect(
        await rpc(learner.client, "get_training_session", {
          p_session_id: snapshot.id,
        }),
      ).toEqual(snapshot);
    }
    expect(
      (
        await later.client.rpc(
          "start_playlist_training_session",
          startArgs(playlist),
        )
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
    expect(
      (
        await later.client.rpc("start_selected_training_session", {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: one.id },
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
  });

  it("never exposes a playlist when source hiding races its publication", async () => {
    const owner = await createVerifiedCreator(),
      operator = await createOperator();
    await saveProfile(owner);
    const scenario = await publishScenarioFixture(owner);
    const reviewed = await reviewPlaylist(
      owner,
      await createPlaylist(owner, [selected(scenario)]),
    );
    const [published, hidden] = await raceBehindLock(
      `scenario:${scenario.id}`,
      2,
      [
        () =>
          owner.client.rpc("publish_creator_playlist", publishArgs(reviewed)),
        () =>
          operator.client.rpc(
            "set_operator_scenario_visibility",
            visibilityArgs(scenario.id, 0),
          ),
      ],
    );
    expect(hidden.error).toBeNull();
    if (published.error)
      expect(published.error.message).toBe("DRAFT_NOT_READY");
    expect(
      (
        await owner.client.rpc("get_library_playlist", {
          p_playlist_id: reviewed.id,
        })
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
  });

  it("permits creator corrections without allowing a publication race to remove the hold", async () => {
    const owner = await createVerifiedCreator(),
      operator = await createOperator();
    let scenario = await publishScenarioFixture(owner);
    scenario = await reviewDraftFixture(
      owner,
      await saveDraftFixture(owner, scenario, {
        ...scenario.draft.content,
        question: "A corrected question published during operator review",
      }),
    );
    const [published, hidden] = await raceBehindLock(
      `scenario:${scenario.id}`,
      2,
      [
        () =>
          owner.client.rpc("publish_creator_scenario", {
            p_scenario_id: scenario.id,
            p_request_id: randomUUID(),
            p_expected_revision: scenario.revision,
            p_review_id: scenario.review!.id,
          }),
        () =>
          operator.client.rpc(
            "set_operator_scenario_visibility",
            visibilityArgs(scenario.id, 0),
          ),
      ],
    );
    expect(published.error).toBeNull();
    expect(hidden.error).toBeNull();
    const current = await rpc<CreatorScenarioSnapshot>(
      owner.client,
      "get_creator_scenario",
      { p_scenario_id: scenario.id },
    );
    expect(current.publication.currentVersion).toBe(
      (published.data as CreatorMutationResponse).publishedVersion,
    );
    expect(current.publication.operatorVisibility.hidden).toBe(true);
    expect(
      (
        await owner.client.rpc("get_library_preview", {
          p_scenario_id: scenario.id,
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
  });

  it("orders trusted revocation against an in-flight operator mutation and rejects subsequent writes", async () => {
    const owner = await createVerifiedCreator(),
      operator = await createOperator();
    const scenario = await publishScenarioFixture(owner);
    const [changed] = await raceBehindLock<{
      error: { message: string } | null;
    }>(`operator:${operator.id}`, 10, [
      async () => {
        const result = await operator.client.rpc(
          "set_operator_scenario_visibility",
          visibilityArgs(scenario.id, 0),
        );
        return { error: result.error };
      },
      async () => {
        await revokeOperatorAsync(operator);
        return { error: null };
      },
    ]);
    if (changed.error) expect(changed.error.message).toBe("OPERATOR_REQUIRED");
    expect(await rpc(operator.client, "get_operator_access")).toBe(false);
    expect(
      (
        await operator.client.rpc(
          "set_operator_scenario_visibility",
          visibilityArgs(scenario.id, changed.error ? 0 : 1, false),
        )
      ).error?.message,
    ).toBe("OPERATOR_REQUIRED");
  });
});
