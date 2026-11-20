import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  CreatorPlaylistSnapshot,
  PlaylistDetail,
  PlaylistMutationResponse,
} from "@/contracts/playlist";
import type {
  CreateSessionResponse,
  SessionHistoryResponse,
} from "@/contracts/session";
import {
  createVerifiedCreator,
  finishSession,
  independentClient,
  publishScenarioFixture,
  rpc,
} from "./helpers/creator-scenarios";
import { createVerifiedTestUser } from "./helpers/test-users";
import {
  createPlaylist,
  playlistChecklist,
  publishArgs,
  publishPlaylist,
  raceBehindLock,
  reviewPlaylist,
  saveProfile,
  selected,
  startArgs,
  withdrawalArgs,
} from "./helpers/playlists";

describe("playlist concurrency with observed PostgreSQL transaction barriers", () => {
  it("serializes duplicate publication receipts into one immutable publication", async () => {
    const owner = await createVerifiedCreator();
    await saveProfile(owner);
    const scenario = await publishScenarioFixture(owner);
    const playlist = await reviewPlaylist(
      owner,
      await createPlaylist(owner, [selected(scenario)]),
    );
    const second = await independentClient(owner),
      args = publishArgs(playlist);
    const results = await raceBehindLock(owner.id, 1, [
      () => owner.client.rpc("publish_creator_playlist", args),
      () => second.rpc("publish_creator_playlist", args),
    ]);
    for (const result of results) expect(result.error).toBeNull();
    const values = results.map(
      (result) => result.data as PlaylistMutationResponse,
    );
    expect(values.map((value) => value.replayed).sort()).toEqual([false, true]);
    expect(new Set(values.map((value) => value.publishedVersion)).size).toBe(1);
    expect(values[0].playlist.revision).toBe(values[1].playlist.revision);
  });

  it("serializes publication against source withdrawal without publishing a partial sequence", async () => {
    const owner = await createVerifiedCreator();
    await saveProfile(owner);
    const one = await publishScenarioFixture(owner),
      two = await publishScenarioFixture(owner);
    const playlist = await reviewPlaylist(
      owner,
      await createPlaylist(owner, [selected(one), selected(two)]),
    );
    const second = await independentClient(owner);
    const [published, withdrawn] = await raceBehindLock(owner.id, 1, [
      () => owner.client.rpc("publish_creator_playlist", publishArgs(playlist)),
      () => second.rpc("unpublish_creator_scenario", withdrawalArgs(one)),
    ]);
    expect(withdrawn.error).toBeNull();
    const current = await rpc<CreatorPlaylistSnapshot>(
      owner.client,
      "get_creator_playlist",
      { p_playlist_id: playlist.id },
    );
    expect(current.draft.content.items).toEqual([selected(one), selected(two)]);
    if (published.error) {
      expect(published.error.message).toBe("DRAFT_NOT_READY");
      expect(current.publication.currentVersion).toBeNull();
    } else {
      expect(current.publication.currentVersion).toBe(
        (published.data as PlaylistMutationResponse).publishedVersion,
      );
      expect(current.publication.availability).toBe("blocked");
    }
    expect(
      (
        await owner.client.rpc("get_library_playlist", {
          p_playlist_id: playlist.id,
        })
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
  });

  it("starts before withdrawal or rejects afterward, while an admitted complete session remains usable", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser();
    await saveProfile(owner);
    const scenario = await publishScenarioFixture(owner);
    const playlist = await publishPlaylist(owner, [selected(scenario)]);
    const [started, withdrawn] = await raceBehindLock(
      `scenario:${scenario.id}`,
      2,
      [
        () =>
          learner.client.rpc(
            "start_playlist_training_session",
            startArgs(playlist),
          ),
        () =>
          owner.client.rpc(
            "unpublish_creator_scenario",
            withdrawalArgs(scenario),
          ),
      ],
    );
    expect(withdrawn.error).toBeNull();
    if (started.error) {
      expect(started.error.message).toBe("PLAYLIST_UNAVAILABLE");
      expect(
        (
          await rpc<SessionHistoryResponse>(
            learner.client,
            "list_training_sessions",
          )
        ).sessions,
      ).toHaveLength(0);
    } else {
      const session = (started.data as CreateSessionResponse).session;
      expect(session.items.map((item) => item.challenge.id)).toEqual([
        scenario.id,
      ]);
      expect((await finishSession(learner, session)).phase).toBe("completed");
    }
  });

  it("pins the previewed publication or returns an explicit changed-preview conflict during republish", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser();
    await saveProfile(owner);
    const scenario = await publishScenarioFixture(owner);
    const playlist = await publishPlaylist(owner, [selected(scenario)]);
    const reviewed = await reviewPlaylist(owner, playlist);
    const [started, published] = await raceBehindLock(
      `playlist:${playlist.id}`,
      7,
      [
        () =>
          learner.client.rpc(
            "start_playlist_training_session",
            startArgs(playlist),
          ),
        () =>
          owner.client.rpc("publish_creator_playlist", publishArgs(reviewed)),
      ],
    );
    expect(published.error).toBeNull();
    expect(
      (published.data as PlaylistMutationResponse).publishedVersion,
    ).not.toBe(playlist.publication.currentVersion);
    if (started.error) {
      expect(started.error.message).toBe("PLAYLIST_CHANGED");
      expect(
        await rpc(learner.client, "get_active_training_session"),
      ).toBeNull();
    } else {
      expect(
        (started.data as CreateSessionResponse).session.playlist
          ?.publicationVersion,
      ).toBe(playlist.publication.currentVersion);
    }
  });

  it("rejects stale profile reviews and never publishes credit that was not reviewed", async () => {
    const owner = await createVerifiedCreator();
    const profile = await saveProfile(owner, "Reviewed Coach");
    const scenario = await publishScenarioFixture(owner);
    let playlist = await createPlaylist(owner, [selected(scenario)]);
    const second = await independentClient(owner);
    const [reviewed, nameSaved] = await raceBehindLock(owner.id, 1, [
      () =>
        owner.client.rpc("review_creator_playlist", {
          p_playlist_id: playlist.id,
          p_request_id: randomUUID(),
          p_expected_revision: playlist.revision,
          p_profile_revision: profile.revision,
          p_checklist: playlistChecklist(),
        }),
      () =>
        second.rpc("save_creator_profile", {
          p_request_id: randomUUID(),
          p_expected_revision: profile.revision,
          p_display_name: "New Review Coach",
        }),
    ]);
    expect(nameSaved.error).toBeNull();
    if (reviewed.error)
      expect(reviewed.error.message).toBe("CREATOR_PROFILE_CONFLICT");
    else {
      playlist = (reviewed.data as PlaylistMutationResponse).playlist;
      expect(
        (
          await owner.client.rpc(
            "publish_creator_playlist",
            publishArgs(playlist),
          )
        ).error?.message,
      ).toBe("REVIEW_REQUIRED");
    }
    playlist = await rpc<CreatorPlaylistSnapshot>(
      owner.client,
      "get_creator_playlist",
      { p_playlist_id: playlist.id },
    );
    playlist = await reviewPlaylist(owner, playlist);
    const [published, renamed] = await raceBehindLock(owner.id, 1, [
      () => owner.client.rpc("publish_creator_playlist", publishArgs(playlist)),
      () =>
        second.rpc("save_creator_profile", {
          p_request_id: randomUUID(),
          p_expected_revision: profile.revision + 1,
          p_display_name: "Latest Coach",
        }),
    ]);
    expect(renamed.error).toBeNull();
    if (published.error)
      expect(published.error.message).toBe("REVIEW_REQUIRED");
    else
      expect(
        (
          await rpc<PlaylistDetail>(owner.client, "get_library_playlist", {
            p_playlist_id: playlist.id,
          })
        ).credit.displayName,
      ).toBe("New Review Coach");
  });

  it("allows only one competing target for a learner and starts reversed overlapping lists without deadlock", async () => {
    const owner = await createVerifiedCreator(),
      learner = await createVerifiedTestUser();
    await saveProfile(owner);
    const one = await publishScenarioFixture(owner),
      two = await publishScenarioFixture(owner);
    const forward = await publishPlaylist(
      owner,
      [selected(one), selected(two)],
      "Forward",
    );
    const reversed = await publishPlaylist(
      owner,
      [selected(two), selected(one)],
      "Reversed",
    );
    const secondClient = await independentClient(learner);
    const competing = await raceBehindLock(learner.id, 0, [
      () =>
        learner.client.rpc(
          "start_playlist_training_session",
          startArgs(forward),
        ),
      () =>
        secondClient.rpc(
          "start_playlist_training_session",
          startArgs(reversed),
        ),
    ]);
    expect(competing.filter((result) => result.error === null)).toHaveLength(1);
    expect(competing.find((result) => result.error)?.error?.message).toBe(
      "ACTIVE_SESSION_EXISTS",
    );
    const history = await rpc<SessionHistoryResponse>(
      learner.client,
      "list_training_sessions",
    );
    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0].totalCount).toBe(2);
    const left = await createVerifiedTestUser(),
      right = await createVerifiedTestUser();
    const firstLockedScenario = [one.id, two.id].sort()[0];
    const starts = await raceBehindLock(`scenario:${firstLockedScenario}`, 2, [
      () =>
        left.client.rpc("start_playlist_training_session", startArgs(forward)),
      () =>
        right.client.rpc(
          "start_playlist_training_session",
          startArgs(reversed),
        ),
    ]);
    for (const result of starts) expect(result.error).toBeNull();
    expect(
      (starts[0].data as CreateSessionResponse).session.items.map(
        (item) => item.challenge.id,
      ),
    ).toEqual([one.id, two.id]);
    expect(
      (starts[1].data as CreateSessionResponse).session.items.map(
        (item) => item.challenge.id,
      ),
    ).toEqual([two.id, one.id]);
  });
});
