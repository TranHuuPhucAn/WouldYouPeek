import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreatorMutationResponse,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import {
  TENZ_PLAYER_ID,
  type PlayerListResponse,
  type PlayerSummary,
} from "@/contracts/player";
import type {
  CreateSessionResponse,
  SessionHistoryResponse,
  SessionSnapshot,
  SessionSummary,
} from "@/contracts/session";
import demoScenarios from "../../supabase/fixtures/demo-scenarios.json";
import { createLocalTestClient } from "./helpers/local-supabase";
import { createVerifiedTestUser, type TestUser } from "./helpers/test-users";
import {
  createDraftFixture,
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
  expect(Object.keys(preview.player).sort()).toEqual(["displayName", "id"]);
  for (const field of [
    "question",
    "decision",
    "options",
    "analysis",
    "observedAction",
    "reveal",
    "review",
    "ownerId",
    "email",
    "storagePath",
    "signedUrl",
  ])
    expect(preview).not.toHaveProperty(field);
}

describe("public player catalogue through real Auth and Data API", () => {
  const prefix = `M6 ${randomUUID()}`;
  const alphaName = `${prefix} Alpha`,
    betaName = `${prefix} Beta`;
  let owner: TestUser, learner: TestUser, other: TestUser, revoked: TestUser;
  let guest: SupabaseClient, alpha: PlayerSummary, beta: PlayerSummary;
  let hiddenDraft: CreatorScenarioSnapshot;
  let scenarios: CreatorScenarioSnapshot[] = [];
  let pinned: SessionSnapshot;

  beforeAll(async () => {
    owner = await createVerifiedCreator();
    [learner, other, revoked] = await Promise.all([
      createVerifiedTestUser(),
      createVerifiedTestUser(),
      createVerifiedTestUser(),
    ]);
    // A genuine existing JWT must not override the database's current verification state.
    const revoke = await createLocalTestClient("admin")
      .from("profiles")
      .update({ email_verified_at: null })
      .eq("user_id", revoked.id);
    expect(revoke.error).toBeNull();
    guest = createLocalTestClient();
    for (const name of [
      alphaName,
      alphaName.toLowerCase(),
      `Ｍ６ ${prefix.slice(3)} Alpha`,
      `  ${alphaName}  `,
      betaName,
    ]) {
      const content = validContent();
      content.source.player = name;
      content.title = `Catalogue ${scenarios.length + 1} ${randomUUID()}`;
      scenarios.push(await publishScenarioFixture(owner, content));
    }
    const content = validContent();
    content.source.player = `${prefix} Hidden draft`;
    hiddenDraft = await createDraftFixture(owner, content);
    const groups = await rpc<PlayerListResponse>(
      guest,
      "list_library_players",
      { p_query: prefix },
    );
    alpha = groups.players.find(
      (group) => group.player.displayName === alphaName,
    )!.player;
    beta = groups.players.find(
      (group) => group.player.displayName === betaName,
    )!.player;
  }, 60_000);
  // Publications and pinned history deliberately survive until the owned disposable stack is removed.

  it("exposes safe published groups to guests and currently unverified JWTs without counting drafts", async () => {
    for (const client of [guest, revoked.client]) {
      const list = await rpc<PlayerListResponse>(
        client,
        "list_library_players",
        { p_query: `  ${prefix.toUpperCase()}  ` },
      );
      expect(list.players).toHaveLength(2);
      const group = list.players.find((entry) => entry.player.id === alpha.id)!;
      expect(group.player).toEqual(alpha);
      expect(group.scenarioCount).toBe(4);
      expect(group.scenarios).toHaveLength(3);
      expect(new Set(group.scenarios.map((entry) => entry.id)).size).toBe(3);
      for (const entry of group.scenarios) {
        expectSafePreview(entry);
        expect(entry.player).toEqual(alpha);
        expect(entry.editorialOrigin).toBe("creator");
        expect(entry.provenance).toBe("creator");
        expect(entry.publishedAt).toEqual(expect.any(String));
      }
      expect(JSON.stringify(list)).not.toContain(owner.email);
      expect(JSON.stringify(list)).not.toContain(hiddenDraft.id);
      const hidden = await client.rpc("get_library_preview", {
        p_scenario_id: hiddenDraft.id,
      });
      expect(hidden.data).toBeNull();
      expect(hidden.error?.message).toBe("SCENARIO_UNAVAILABLE");
      expect(
        (
          await rpc<PlayerListResponse>(client, "list_library_players", {
            p_query: `${prefix} Hidden`,
          })
        ).players,
      ).toEqual([]);
    }
    expect(
      (await guest.rpc("get_active_training_session")).error,
    ).not.toBeNull();
    expect(
      (await revoked.client.rpc("get_active_training_session")).error?.message,
    ).toBe("EMAIL_NOT_VERIFIED");
    expect(
      (
        await revoked.client.rpc("start_selected_training_session", {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: demoScenarios[0].id },
        })
      ).error?.message,
    ).toBe("EMAIL_NOT_VERIFIED");
  });

  it("keeps the three curated slug previews public with their original AI provenance", async () => {
    expect(demoScenarios).toHaveLength(3);
    for (const scenario of demoScenarios) {
      const preview = await rpc<LibraryScenarioPreview>(
        guest,
        "get_library_preview",
        { p_scenario_id: scenario.id },
      );
      expectSafePreview(preview);
      expect(preview).toMatchObject({
        id: scenario.id,
        title: scenario.title,
        editorialOrigin: "curated",
        provenance: "ai",
        publishedAt: null,
        player: { id: TENZ_PLAYER_ID, displayName: "TenZ" },
      });
    }
    expect(
      await rpc<PlayerSummary | null>(guest, "get_library_player", {
        p_player_id: TENZ_PLAYER_ID,
      }),
    ).toEqual({ id: TENZ_PLAYER_ID, displayName: "TenZ" });
    expect(
      await rpc<PlayerSummary | null>(guest, "get_library_player", {
        p_player_id: randomUUID(),
      }),
    ).toBeNull();
    expect((await guest.from("players").select("*")).error).not.toBeNull();
    expect(
      (await revoked.client.from("players").select("*")).error,
    ).not.toBeNull();
  });

  it("paginates entire player groups and binds each real cursor to its search or player filter", async () => {
    const first = await rpc<PlayerListResponse>(guest, "list_library_players", {
      p_query: prefix,
      p_limit: 1,
    });
    expect(first.players).toHaveLength(1);
    expect(first.players[0].player).toEqual(alpha);
    expect(first.players[0].scenarioCount).toBe(4);
    expect(first.nextCursor).toEqual(expect.any(String));
    const next = await rpc<PlayerListResponse>(guest, "list_library_players", {
      p_query: prefix,
      p_limit: 1,
      p_cursor: first.nextCursor,
    });
    expect(next.players.map((group) => group.player.id)).toEqual([beta.id]);
    expect(next.nextCursor).toBeNull();
    expect(
      (
        await guest.rpc("list_library_players", {
          p_query: "tenz",
          p_cursor: first.nextCursor,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");

    const page = await rpc<LibraryListResponse>(
      guest,
      "list_library_previews",
      { p_player_id: alpha.id, p_limit: 2 },
    );
    expect(page.scenarios).toHaveLength(2);
    expect(page.nextCursor).toEqual(expect.any(String));
    const rest = await rpc<LibraryListResponse>(
      guest,
      "list_library_previews",
      { p_player_id: alpha.id, p_limit: 2, p_cursor: page.nextCursor },
    );
    expect(rest.scenarios).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    expect(
      new Set([...page.scenarios, ...rest.scenarios].map((item) => item.id))
        .size,
    ).toBe(4);
    expect(
      [...page.scenarios, ...rest.scenarios].every(
        (item) => item.player.id === alpha.id,
      ),
    ).toBe(true);
    for (const playerId of [null, beta.id])
      expect(
        (
          await guest.rpc("list_library_previews", {
            p_player_id: playerId,
            p_cursor: page.nextCursor,
          })
        ).error?.message,
      ).toBe("INVALID_REQUEST");
  });

  it("reads active progress without creating anything and starts each curated slug as one pinned scenario", async () => {
    const historyBefore = await rpc<SessionHistoryResponse>(
      learner.client,
      "list_training_sessions",
    );
    expect(historyBefore.sessions).toEqual([]);
    for (let i = 0; i < 2; i++) {
      expect(
        await rpc<SessionSummary | null>(
          learner.client,
          "get_active_training_session",
        ),
      ).toBeNull();
      await rpc(learner.client, "list_library_players");
      await rpc(learner.client, "list_library_previews", {
        p_player_id: TENZ_PLAYER_ID,
      });
    }
    expect(
      (
        await rpc<SessionHistoryResponse>(
          learner.client,
          "list_training_sessions",
        )
      ).sessions,
    ).toEqual([]);
    for (const scenario of demoScenarios) {
      const command = {
        p_request_id: randomUUID(),
        p_target: { kind: "scenario", scenarioId: scenario.id },
      };
      const started = await rpc<CreateSessionResponse>(
        learner.client,
        "start_selected_training_session",
        command,
      );
      expect(started.created).toBe(true);
      expect(started.session.target).toEqual(command.p_target);
      expect(started.session.items).toHaveLength(1);
      expect(started.session.items[0]).toMatchObject({
        challenge: { id: scenario.id, contentVersion: scenario.contentVersion },
        answer: null,
      });
      expect(
        await rpc<CreateSessionResponse>(
          learner.client,
          "start_selected_training_session",
          command,
        ),
      ).toMatchObject({ replayed: true, session: { id: started.session.id } });
      const active = await rpc<SessionSummary>(
        learner.client,
        "get_active_training_session",
      );
      expect(active).toMatchObject({
        id: started.session.id,
        target: command.p_target,
        totalCount: 1,
        answeredCount: 0,
      });
      expect(active).not.toHaveProperty("items");
      expect(
        await rpc<SessionSummary | null>(
          other.client,
          "get_active_training_session",
        ),
      ).toBeNull();
      await finishSession(learner, started.session);
      expect(
        await rpc<SessionSummary | null>(
          learner.client,
          "get_active_training_session",
        ),
      ).toBeNull();
    }
    const history = await rpc<SessionHistoryResponse>(
      learner.client,
      "list_training_sessions",
    );
    expect(history.sessions).toHaveLength(3);
    expect(
      history.sessions.every(
        (session) => session.status === "completed" && session.totalCount === 1,
      ),
    ).toBe(true);
  });

  it("changes grouping only on publication and keeps historical player attribution in saved sessions", async () => {
    let scenario = scenarios[0];
    pinned = await startSingle(learner, scenario.id);
    const oldTitle = scenario.draft.content.title;
    const content = structuredClone(scenario.draft.content);
    content.title = `Current published metadata ${randomUUID()}`;
    content.source.player = betaName;
    content.analysis.author = "ai-assisted";
    scenario = await saveDraftFixture(owner, scenario, content);
    const beforePublish = await rpc<LibraryScenarioPreview>(
      guest,
      "get_library_preview",
      { p_scenario_id: scenario.id },
    );
    expect(beforePublish.title).toBe(oldTitle);
    expect(beforePublish.player).toEqual(alpha);
    scenario = await reviewDraftFixture(owner, scenario);
    scenario = (
      await rpc<CreatorMutationResponse>(
        owner.client,
        "publish_creator_scenario",
        {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
          p_review_id: scenario.review!.id,
        },
      )
    ).scenario;
    scenarios[0] = scenario;
    const current = await rpc<LibraryScenarioPreview>(
      guest,
      "get_library_preview",
      { p_scenario_id: scenario.id },
    );
    expect(current).toMatchObject({
      title: content.title,
      player: beta,
      provenance: "ai-assisted",
      editorialOrigin: "creator",
      source: { player: betaName },
    });
    const groups = await rpc<PlayerListResponse>(
      guest,
      "list_library_players",
      { p_query: prefix },
    );
    expect(
      groups.players.find((group) => group.player.id === alpha.id)
        ?.scenarioCount,
    ).toBe(3);
    expect(
      groups.players.find((group) => group.player.id === beta.id)
        ?.scenarioCount,
    ).toBe(2);
    expect(
      groups.players
        .flatMap((group) => group.scenarios)
        .filter((entry) => entry.id === scenario.id),
    ).toHaveLength(1);
    const preserved = await rpc<SessionSnapshot>(
      learner.client,
      "get_training_session",
      { p_session_id: pinned.id },
    );
    expect(preserved.items[0].challenge).toMatchObject({
      title: oldTitle,
      source: { player: alphaName },
      contentVersion: "creator-1",
    });
    const fresh = await startSingle(other, scenario.id);
    expect(fresh.items[0].challenge).toMatchObject({
      title: content.title,
      source: { player: betaName },
      contentVersion: "creator-2",
    });
  });

  it("removes withdrawn scenarios and empty player routes while saved sessions remain playable", async () => {
    for (const scenario of scenarios)
      await rpc<CreatorMutationResponse>(
        owner.client,
        "unpublish_creator_scenario",
        {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
        },
      );
    expect(
      (
        await rpc<PlayerListResponse>(guest, "list_library_players", {
          p_query: prefix,
        })
      ).players,
    ).toEqual([]);
    for (const player of [alpha, beta]) {
      expect(
        await rpc<PlayerSummary | null>(guest, "get_library_player", {
          p_player_id: player.id,
        }),
      ).toBeNull();
      expect(
        (
          await rpc<LibraryListResponse>(guest, "list_library_previews", {
            p_player_id: player.id,
          })
        ).scenarios,
      ).toEqual([]);
    }
    for (const scenario of scenarios) {
      const result = await guest.rpc("get_library_preview", {
        p_scenario_id: scenario.id,
      });
      expect(result.data).toBeNull();
      expect(result.error?.message).toBe("SCENARIO_UNAVAILABLE");
    }
    const newcomer = await createVerifiedTestUser();
    expect(
      (
        await newcomer.client.rpc("start_selected_training_session", {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: scenarios[0].id },
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    const saved = await rpc<SessionSnapshot>(
      learner.client,
      "get_training_session",
      { p_session_id: pinned.id },
    );
    expect(saved).toEqual(pinned);
    expect((await finishSession(learner, saved)).phase).toBe("completed");
  });

  it("converges concurrent first publications by two creators on one new normalized player", async () => {
    const suffix = randomUUID();
    const name = `Concurrent ${suffix} Player`;
    const names = [name, `  concurrent   ${suffix}   player  `];
    const creators = await Promise.all([
      createVerifiedCreator(),
      createVerifiedCreator(),
    ]);
    const reviewed = await Promise.all(
      creators.map(async (creator, index) => {
        const content = validContent();
        content.source.player = names[index];
        content.title = `Concurrent publication ${index + 1} ${suffix}`;
        return reviewDraftFixture(
          creator,
          await createDraftFixture(creator, content),
        );
      }),
    );
    expect(
      (
        await rpc<PlayerListResponse>(guest, "list_library_players", {
          p_query: name,
        })
      ).players,
    ).toEqual([]);
    const commands = reviewed.map((scenario) => ({
      p_scenario_id: scenario.id,
      p_request_id: randomUUID(),
      p_expected_revision: scenario.revision,
      p_review_id: scenario.review!.id,
    }));
    // Each publisher uses its own authenticated connection; release both calls
    // together so the unique player resolver has to arbitrate first publication.
    const results = await race(
      () => creators[0].client.rpc("publish_creator_scenario", commands[0]),
      () => creators[1].client.rpc("publish_creator_scenario", commands[1]),
    );
    for (const result of results) {
      expect(result.error).toBeNull();
      expect((result.data as CreatorMutationResponse).publishedVersion).toBe(
        "creator-1",
      );
    }
    const previews = await Promise.all(
      reviewed.map((scenario) =>
        rpc<LibraryScenarioPreview>(guest, "get_library_preview", {
          p_scenario_id: scenario.id,
        }),
      ),
    );
    expect(previews[0].player.id).toBe(previews[1].player.id);
    const groups = await rpc<PlayerListResponse>(
      guest,
      "list_library_players",
      {
        p_query: name.toUpperCase(),
      },
    );
    expect(groups.players).toHaveLength(1);
    expect(groups.players[0].player).toEqual(previews[0].player);
    expect(groups.players[0].scenarioCount).toBe(2);
    expect(
      groups.players[0].scenarios.map((scenario) => scenario.id).sort(),
    ).toEqual(reviewed.map((scenario) => scenario.id).sort());
  });
});
