import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CreatorScenarioSnapshot } from "@/contracts/creator";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import type {
  OperatorReportDetail,
  VisibilityResponse,
} from "@/contracts/moderation";
import type { CreatorPlaylistSnapshot } from "@/contracts/playlist";
import type { PlayerListResponse } from "@/contracts/player";
import type { SessionSnapshot } from "@/contracts/session";
import {
  createVerifiedCreator,
  publishScenarioFixture,
  rpc,
  saveDraftFixture,
  validContent,
} from "./helpers/creator-scenarios";
import { createLocalTestClient } from "./helpers/local-supabase";
import { createVerifiedTestUser } from "./helpers/test-users";
import {
  publishPlaylist,
  publishReviewed,
  republishScenario,
  reviewPlaylist,
  savePlaylist,
  saveProfile,
  selected,
  startArgs,
  startPlaylist,
  withdrawScenario,
} from "./helpers/playlists";
import {
  createOperator,
  moderationSql,
  publicationTarget,
  revokeOperator,
  setVisibility,
  sqlLiteral,
  submitReport,
  visibilityArgs,
} from "./helpers/moderation";
import {
  fixture,
  objectPath,
  uploadedContent,
  uploadReady,
} from "./helpers/videos";

describe("independent operator visibility", () => {
  it("hides discovery and new starts while preserving saved sessions and creator ownership", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser(),
      newLearner = await createVerifiedTestUser(),
      operator = await createOperator();
    await saveProfile(owner);
    const content = validContent();
    content.source.player = `Visibility ${randomUUID().slice(0, 12)}`;
    let one = await publishScenarioFixture(owner, content);
    const two = await publishScenarioFixture(owner, content);
    const preview = await rpc<LibraryScenarioPreview>(
      createLocalTestClient(),
      "get_library_preview",
      { p_scenario_id: one.id },
    );
    let playlist = await publishPlaylist(owner, [selected(one), selected(two)]);
    const originalSession = (await startPlaylist(learner, playlist)).session;
    const reported = await submitReport(
      learner,
      await publicationTarget(one.id),
    );
    const command = visibilityArgs(one.id, 0);
    const hidden = await rpc<VisibilityResponse>(
      operator.client,
      "set_operator_scenario_visibility",
      command,
    );
    expect(hidden.visibility).toMatchObject({
      hidden: true,
      revision: 1,
      affectedPlaylistCount: 1,
      creatorPublished: true,
    });
    expect(
      (
        await rpc<VisibilityResponse>(
          operator.client,
          "set_operator_scenario_visibility",
          command,
        )
      ).replayed,
    ).toBe(true);
    expect(
      (
        await newLearner.client.rpc("start_selected_training_session", {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: one.id },
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    expect(
      (
        await newLearner.client.rpc(
          "start_playlist_training_session",
          startArgs(playlist),
        )
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
    expect(
      (
        await createLocalTestClient().rpc("get_library_preview", {
          p_scenario_id: one.id,
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    expect(
      (
        await createLocalTestClient().rpc("get_library_playlist", {
          p_playlist_id: playlist.id,
        })
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
    const visible = await rpc<LibraryListResponse>(
      createLocalTestClient(),
      "list_library_previews",
      { p_player_id: preview.player.id },
    );
    expect(visible.scenarios.map((item) => item.id)).toEqual([two.id]);
    const grouped = await rpc<PlayerListResponse>(
      createLocalTestClient(),
      "list_library_players",
      { p_query: content.source.player },
    );
    expect(grouped.players[0].scenarioCount).toBe(1);
    expect(grouped.players[0].scenarios.map((item) => item.id)).toEqual([
      two.id,
    ]);
    expect(
      await rpc<SessionSnapshot>(learner.client, "get_training_session", {
        p_session_id: originalSession.id,
      }),
    ).toEqual(originalSession);
    one = await rpc<CreatorScenarioSnapshot>(
      owner.client,
      "get_creator_scenario",
      { p_scenario_id: one.id },
    );
    expect(one.publication.operatorVisibility).toMatchObject({
      hidden: true,
      reason: command.p_reason,
    });
    expect(JSON.stringify(one)).not.toContain(learner.id);
    expect(
      (
        await owner.client.rpc(
          "set_operator_scenario_visibility",
          visibilityArgs(one.id, 1, false),
        )
      ).error?.message,
    ).toBe("OPERATOR_REQUIRED");
    one = await republishScenario(
      owner,
      await saveDraftFixture(owner, one, {
        ...one.draft.content,
        question: "Corrected content remains under the independent hold",
      }),
    );
    expect(one.publication.operatorVisibility.hidden).toBe(true);
    expect(
      (
        await createLocalTestClient().rpc("get_library_preview", {
          p_scenario_id: one.id,
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    const report = await rpc<OperatorReportDetail>(
      operator.client,
      "get_operator_report",
      { p_report_id: reported.report.id },
    );
    expect(report.report.status).toBe("open");
    expect(report.report.contentVersion).not.toBe(
      report.visibility.currentContentVersion,
    );
    await setVisibility(operator, one.id, 1, false);
    expect((await publicationTarget(one.id)).contentVersion).toBe(
      one.publication.currentVersion,
    );
    one = await rpc<CreatorScenarioSnapshot>(
      owner.client,
      "get_creator_scenario",
      { p_scenario_id: one.id },
    );
    expect(one.publication.operatorVisibility).toEqual({
      hidden: false,
      reason: null,
      changedAt: null,
    });
    expect(
      (
        await createLocalTestClient().rpc("get_library_playlist", {
          p_playlist_id: playlist.id,
        })
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
    playlist = await rpc<CreatorPlaylistSnapshot>(
      owner.client,
      "get_creator_playlist",
      { p_playlist_id: playlist.id },
    );
    playlist = await savePlaylist(owner, playlist, {
      ...playlist.draft.content,
      items: [selected(one), selected(two)],
    });
    playlist = await publishReviewed(
      owner,
      await reviewPlaylist(owner, playlist),
    );
    expect(
      (await startPlaylist(newLearner, playlist)).session.playlist
        ?.publicationVersion,
    ).toBe(playlist.publication.currentVersion);
    expect(
      await rpc<SessionSnapshot>(learner.client, "get_training_session", {
        p_session_id: originalSession.id,
      }),
    ).toEqual(originalSession);
  });

  it("restoring does not republish a creator-withdrawn scenario or clear the audit trail", async () => {
    const owner = await createVerifiedCreator(),
      operator = await createOperator();
    let scenario = await publishScenarioFixture(owner);
    await setVisibility(operator, scenario.id, 0);
    scenario = await withdrawScenario(owner, scenario);
    const restored = await setVisibility(operator, scenario.id, 1, false);
    expect(restored.visibility).toMatchObject({
      hidden: false,
      creatorPublished: false,
      revision: 2,
    });
    expect(
      (
        await createLocalTestClient().rpc("get_library_preview", {
          p_scenario_id: scenario.id,
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    expect(
      (
        await operator.client.rpc(
          "set_operator_scenario_visibility",
          visibilityArgs(scenario.id, 1, true),
        )
      ).error?.message,
    ).toBe("VISIBILITY_CONFLICT");
    expect(
      Number(
        moderationSql(
          `select generation from private.scenario_availability_fences where scenario_id=${sqlLiteral(scenario.id)};`,
        ),
      ),
    ).toBe(2);
  });

  it("authorizes actual reported uploaded media only for current operators without learner attempts", async () => {
    const owner = await createVerifiedCreator(),
      reporter = await createVerifiedTestUser(),
      operator = await createOperator(),
      stranger = await createVerifiedTestUser();
    const bytes = await fixture(),
      video = await uploadReady(owner, bytes);
    const scenario = await publishScenarioFixture(
      owner,
      uploadedContent(video.id),
    );
    const report = await submitReport(
      reporter,
      await publicationTarget(scenario.id),
      "broken_video",
    );
    await setVisibility(operator, scenario.id, 0);
    const detail = await rpc<OperatorReportDetail>(
      operator.client,
      "get_operator_report",
      { p_report_id: report.report.id },
    );
    expect(detail.media.challenge.setup.kind).toBe("uploaded-video");
    for (const phase of ["setup", "reveal"] as const) {
      const context = {
        kind: "operator-report",
        reportId: report.report.id,
        phase,
      };
      expect(
        (
          await rpc<{ assetId: string }>(
            operator.client,
            "authorize_video_playback",
            { p_context: context },
          )
        ).assetId,
      ).toBe(video.id);
      expect(
        (
          await stranger.client.rpc("authorize_video_playback", {
            p_context: context,
          })
        ).error?.message,
      ).toBe("OPERATOR_REQUIRED");
    }
    const signed = await operator.client.storage
      .from("creator-vods")
      .createSignedUrl(objectPath(owner, video.id), 300);
    expect(signed.error).toBeNull();
    const response = await fetch(signed.data!.signedUrl, {
      headers: { Range: "bytes=0-127" },
    });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(0, 128),
    );
    expect(
      (await operator.client.from("training_sessions").select("id")).data,
    ).toEqual([]);
    expect((await operator.client.from("attempts").select("id")).data).toEqual(
      [],
    );
    expect(
      (
        await operator.client.rpc("authorize_video_playback", {
          p_context: {
            kind: "operator-report",
            reportId: report.report.id,
            phase: "setup",
            assetId: randomUUID(),
          },
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
    expect(
      (
        await operator.client.rpc("authorize_video_playback", {
          p_context: {
            kind: "operator-report",
            reportId: randomUUID(),
            phase: "reveal",
          },
        })
      ).error,
    ).not.toBeNull();
    revokeOperator(operator);
    expect(
      (
        await operator.client.rpc("authorize_video_playback", {
          p_context: {
            kind: "operator-report",
            reportId: report.report.id,
            phase: "setup",
          },
        })
      ).error?.message,
    ).toBe("OPERATOR_REQUIRED");
    expect(
      (
        await operator.client.storage
          .from("creator-vods")
          .createSignedUrl(objectPath(owner, video.id), 300)
      ).error,
    ).not.toBeNull();
  }, 60_000);
});
