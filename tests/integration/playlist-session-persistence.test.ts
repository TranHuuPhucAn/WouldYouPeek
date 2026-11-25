import { randomUUID, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  SessionHistoryResponse,
  SessionMutationResponse,
  SessionSnapshot,
  SessionSummary,
} from "@/contracts/session";
import type { PlaylistMutationResponse } from "@/contracts/playlist";
import {
  createVerifiedCreator,
  finishSession,
  independentClient,
  publishScenarioFixture,
  rpc,
  saveDraftFixture,
  validContent,
} from "./helpers/creator-scenarios";
import { createLocalTestClient } from "./helpers/local-supabase";
import { createVerifiedTestUser } from "./helpers/test-users";
import {
  fixture,
  objectPath,
  uploadedContent,
  uploadReady,
} from "./helpers/videos";
import {
  expectMetadataOnly,
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

describe("immutable playlist sessions and uploaded playback", () => {
  it("reloads saved answers and original media across source changes, playlist edits and withdrawal", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser(),
      stranger = await createVerifiedTestUser();
    const profile = await saveProfile(owner, "Original Session Coach");
    const bytes = await fixture();
    const video = await uploadReady(owner, bytes);
    let uploaded = await publishScenarioFixture(
      owner,
      uploadedContent(video.id),
    );
    let youtube = await publishScenarioFixture(owner);
    let playlist = await publishPlaylist(
      owner,
      [selected(uploaded), selected(youtube)],
      "Original practice sequence",
    );
    const initial = await startPlaylist(learner, playlist);
    let session = initial.session;
    const originalMetadata = structuredClone(session.playlist);
    const originalQuestions = session.items.map(
      (item) => item.challenge.question,
    );
    expect(session.items.map((item) => item.challenge.id)).toEqual([
      uploaded.id,
      youtube.id,
    ]);
    expect(session.items.map((item) => item.position)).toEqual([0, 1]);
    const context = {
      kind: "session-item",
      sessionId: session.id,
      itemId: session.items[0].id,
      phase: "setup",
    };
    expect(
      (
        await rpc<{ assetId: string }>(
          learner.client,
          "authorize_video_playback",
          { p_context: context },
        )
      ).assetId,
    ).toBe(video.id);
    expect(
      (
        await learner.client.rpc("authorize_video_playback", {
          p_context: { ...context, phase: "reveal" },
        })
      ).error?.message,
    ).toBe("VIDEO_NOT_FOUND");
    expect(
      (
        await stranger.client.rpc("authorize_video_playback", {
          p_context: context,
        })
      ).error?.message,
    ).toBe("SESSION_NOT_FOUND");
    const first = session.items[0];
    const answerArgs = {
      p_session_id: session.id,
      p_item_id: first.id,
      p_option_id: first.challenge.options[0].id,
      p_request_id: randomUUID(),
      p_expected_revision: session.revision,
    };
    session = (
      await rpc<SessionMutationResponse>(
        learner.client,
        "submit_session_answer",
        answerArgs,
      )
    ).session;
    expect(session.phase).toBe("review");
    const fresh = await independentClient(learner);
    expect(
      await rpc<SessionSnapshot>(fresh, "get_training_session", {
        p_session_id: session.id,
      }),
    ).toEqual(session);
    const replacement = validContent();
    replacement.question =
      "A newer source and explanation must not replace this saved run";
    uploaded = await republishScenario(
      owner,
      await saveDraftFixture(owner, uploaded, replacement),
    );
    youtube = await republishScenario(
      owner,
      await saveDraftFixture(owner, youtube, {
        ...youtube.draft.content,
        question: "A newly edited second decision",
        analysis: { ...youtube.draft.content.analysis, author: "ai-assisted" },
      }),
    );
    await saveProfile(owner, "Replacement Coach", profile.revision);
    playlist = await savePlaylist(owner, playlist, {
      ...playlist.draft.content,
      title: "Replacement practice order",
      items: [selected(youtube), selected(uploaded)],
    });
    playlist = await publishReviewed(
      owner,
      await reviewPlaylist(owner, playlist),
    );
    const oldAfterEdit = await rpc<SessionSnapshot>(
      fresh,
      "get_training_session",
      { p_session_id: session.id },
    );
    expect(oldAfterEdit.playlist).toEqual(originalMetadata);
    expect(oldAfterEdit.items.map((item) => item.challenge.question)).toEqual(
      originalQuestions,
    );
    expect((await startPlaylist(learner, playlist)).session.id).toBe(
      session.id,
    );
    const withdrawal = await rpc<PlaylistMutationResponse>(
      owner.client,
      "unpublish_creator_playlist",
      {
        p_playlist_id: playlist.id,
        p_request_id: randomUUID(),
        p_expected_revision: playlist.revision,
      },
    );
    uploaded = await withdrawScenario(owner, uploaded);
    youtube = await withdrawScenario(owner, youtube);
    expect(withdrawal.playlist.publication.state).toBe("withdrawn");
    expect((await startPlaylist(learner, playlist)).created).toBe(false);
    expect(
      (
        await stranger.client.rpc(
          "start_playlist_training_session",
          startArgs(playlist),
        )
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
    expect(
      (
        await rpc<{ assetId: string }>(fresh, "authorize_video_playback", {
          p_context: { ...context, phase: "reveal" },
        })
      ).assetId,
    ).toBe(video.id);
    expect(
      (
        await learner.client.rpc("authorize_video_playback", {
          p_context: { kind: "library-scenario", scenarioId: uploaded.id },
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    const stored = await createLocalTestClient("admin")
      .storage.from("creator-vods")
      .download(objectPath(owner, video.id));
    expect(stored.error).toBeNull();
    expect(
      createHash("sha256")
        .update(Buffer.from(await stored.data!.arrayBuffer()))
        .digest("hex"),
    ).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(
      (
        await owner.client.rpc("begin_creator_video_delete", {
          p_asset_id: video.id,
          p_request_id: randomUUID(),
          p_expected_revision: video.revision,
        })
      ).error?.message,
    ).toBe("VIDEO_IN_USE");
    const replay = await rpc<SessionMutationResponse>(
      fresh,
      "submit_session_answer",
      answerArgs,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.session.items[0].answer).toEqual(session.items[0].answer);
    session = await finishSession(learner, replay.session);
    expect(
      session.items.map((item) => item.answer?.result.analysis?.author),
    ).toEqual(["creator", "creator"]);
    expect(session.playlist).toEqual(originalMetadata);
    expect(session.title).toBe("Original practice sequence");
    // Completed recap replay still resolves the original version after both
    // source edits and withdrawal. Authorization is a read, not an advance.
    for (const phase of ["setup", "reveal"] as const) {
      expect(
        (
          await rpc<{ assetId: string }>(fresh, "authorize_video_playback", {
            p_context: { ...context, phase },
          })
        ).assetId,
      ).toBe(video.id);
      expect(
        (
          await stranger.client.rpc("authorize_video_playback", {
            p_context: { ...context, phase },
          })
        ).error?.message,
      ).toBe("SESSION_NOT_FOUND");
    }
    expect(
      await rpc<SessionSnapshot>(fresh, "get_training_session", {
        p_session_id: session.id,
      }),
    ).toEqual(session);
    const history = await rpc<SessionHistoryResponse>(
      fresh,
      "list_training_sessions",
    );
    expect(history.sessions).toContainEqual(
      expect.objectContaining({
        id: session.id,
        title: session.title,
        target: session.target,
        playlist: originalMetadata,
        totalCount: 2,
        answeredCount: 2,
        status: "completed",
      }),
    );
    expect(
      await rpc<SessionSummary | null>(fresh, "get_active_training_session"),
    ).toBeNull();
  });

  it("rejects stale previews atomically and preserves the one-active-session rule and retry identity", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser();
    await saveProfile(owner);
    const source = await publishScenarioFixture(owner);
    const old = await publishPlaylist(owner, [selected(source)]);
    const newer = await publishReviewed(
      owner,
      await reviewPlaylist(owner, old),
    );
    expect(
      (
        await learner.client.rpc(
          "start_playlist_training_session",
          startArgs(old),
        )
      ).error?.message,
    ).toBe("PLAYLIST_CHANGED");
    expect(await rpc(learner.client, "get_active_training_session")).toBeNull();
    expect(
      (
        await rpc<SessionHistoryResponse>(
          learner.client,
          "list_training_sessions",
        )
      ).sessions,
    ).toEqual([]);
    const requestId = randomUUID();
    const started = await startPlaylist(learner, newer, requestId);
    expect(started.created).toBe(true);
    const duplicate = await startPlaylist(learner, newer, requestId);
    expect(duplicate.replayed).toBe(true);
    expect(duplicate.session.id).toBe(started.session.id);
    expect(
      (
        await learner.client.rpc(
          "start_playlist_training_session",
          startArgs(old, requestId),
        )
      ).error?.message,
    ).toBe("IDEMPOTENCY_CONFLICT");
    const conflict = await learner.client.rpc("start_training_session", {
      p_request_id: randomUUID(),
    });
    expect(conflict.error?.message).toBe("ACTIVE_SESSION_EXISTS");
    const active = JSON.parse(conflict.error!.details).activeSession;
    expect(active).toMatchObject({
      id: started.session.id,
      target: started.session.target,
      playlist: started.session.playlist,
      totalCount: 1,
    });
    expectMetadataOnly(active);
    const complete = await finishSession(learner, started.session);
    expect((await startPlaylist(learner, newer, requestId)).session).toEqual(
      complete,
    );
    const single = await rpc<{ session: SessionSnapshot }>(
      learner.client,
      "start_selected_training_session",
      {
        p_request_id: randomUUID(),
        p_target: { kind: "scenario", scenarioId: source.id },
      },
    );
    expect(single.session).not.toHaveProperty("playlist");
  });

  it("starts and completes twenty distinct pinned decisions in their exact order", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser();
    await saveProfile(owner);
    const scenarios = [];
    for (let index = 0; index < 20; index++)
      scenarios.push(
        await publishScenarioFixture(owner, {
          ...validContent(),
          title: `Position ${index + 1}`,
        }),
      );
    const playlist = await publishPlaylist(owner, scenarios.map(selected));
    const started = await startPlaylist(learner, playlist);
    expect(started.session.items.map((item) => item.challenge.id)).toEqual(
      scenarios.map((item) => item.id),
    );
    expect(started.session.items.map((item) => item.position)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    const complete = await finishSession(learner, started.session);
    expect(complete.items.every((item) => item.answer !== null)).toBe(true);
    expect(complete.revision).toBe(40);
    expect(complete.phase).toBe("completed");
    expect(
      (
        await rpc<SessionHistoryResponse>(
          learner.client,
          "list_training_sessions",
        )
      ).sessions[0],
    ).toMatchObject({
      answeredCount: 20,
      totalCount: 20,
      playlist: started.session.playlist,
    });
  }, 60_000);
});
