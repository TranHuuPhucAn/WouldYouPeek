import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  CreatorPlaylistScenarioList,
  CreatorPlaylistSnapshot,
  LibraryPlaylistResponse,
  PlaylistDetail,
  PlaylistMutationResponse,
} from "@/contracts/playlist";
import type {
  CreatorProfile,
  CreatorProfileMutationResponse,
} from "@/contracts/creator-profile";
import {
  createDraftFixture,
  createVerifiedCreator,
  publishScenarioFixture,
  rpc,
  saveDraftFixture,
  validContent,
} from "./helpers/creator-scenarios";
import { createLocalTestClient } from "./helpers/local-supabase";
import { createVerifiedTestUser } from "./helpers/test-users";
import {
  createPlaylist,
  expectMetadataOnly,
  playlistChecklist,
  publishArgs,
  publishPlaylist,
  publishReviewed,
  republishScenario,
  reviewPlaylist,
  savePlaylist,
  saveProfile,
  selected,
  withdrawScenario,
} from "./helpers/playlists";

describe("creator playlists through real Auth and Data clients", () => {
  // Immutable publications deliberately remain until disposal of the owned stack.
  it("requires an explicit public name, isolates owners, and publishes full mixed-player metadata", async () => {
    const owner = await createVerifiedCreator(),
      other = await createVerifiedCreator(),
      learner = await createVerifiedTestUser();
    const guest = createLocalTestClient();
    expect(
      await rpc<CreatorProfile>(owner.client, "get_creator_profile"),
    ).toEqual({ displayName: null, revision: 0 });
    const prefix = `Mixed ${randomUUID()}`;
    const oneContent = validContent();
    oneContent.source.player = `${prefix} Alpha`;
    const twoContent = validContent();
    twoContent.source.player = `${prefix} Beta`;
    const one = await publishScenarioFixture(owner, oneContent),
      two = await publishScenarioFixture(owner, twoContent);
    await createDraftFixture(owner, {
      ...validContent(),
      title: "Private candidate draft",
    });
    const foreign = await publishScenarioFixture(other);
    let playlist = await createPlaylist(owner, [selected(two), selected(one)]);
    expect(playlist.readiness.canReview).toBe(false);
    expect(
      (
        await owner.client.rpc("review_creator_playlist", {
          p_playlist_id: playlist.id,
          p_request_id: randomUUID(),
          p_expected_revision: playlist.revision,
          p_profile_revision: 0,
          p_checklist: playlistChecklist(),
        })
      ).error?.message,
    ).toBe("DRAFT_NOT_READY");
    const profile = await saveProfile(owner, "  Public\u00a0  Coach  ");
    expect(profile.displayName).toBe("Public Coach");
    const candidates = await rpc<CreatorPlaylistScenarioList>(
      owner.client,
      "list_creator_playlist_scenarios",
    );
    expect(
      new Set(candidates.scenarios.map((item) => item.scenarioId)),
    ).toEqual(new Set([one.id, two.id]));
    expectMetadataOnly(candidates, owner);
    const missing = await other.client.rpc("get_creator_playlist", {
      p_playlist_id: randomUUID(),
    });
    const denied = await other.client.rpc("get_creator_playlist", {
      p_playlist_id: playlist.id,
    });
    expect(denied.error?.message).toBe("PLAYLIST_NOT_FOUND");
    expect(denied.error).toEqual(missing.error);
    expect(
      (
        await other.client.rpc("save_creator_playlist", {
          p_playlist_id: playlist.id,
          p_request_id: randomUUID(),
          p_expected_revision: playlist.revision,
          p_content: playlist.draft.content,
        })
      ).error?.message,
    ).toBe("PLAYLIST_NOT_FOUND");
    expect(
      (
        await owner.client.rpc("save_creator_playlist", {
          p_playlist_id: playlist.id,
          p_request_id: randomUUID(),
          p_expected_revision: playlist.revision,
          p_content: { ...playlist.draft.content, items: [selected(foreign)] },
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
    playlist = await publishReviewed(
      owner,
      await reviewPlaylist(owner, playlist, profile),
    );
    const detail = await rpc<PlaylistDetail>(guest, "get_library_playlist", {
      p_playlist_id: playlist.id,
    });
    expect(detail.credit).toEqual({
      kind: "creator",
      displayName: "Public Coach",
    });
    expect(detail.items.map((item) => item.scenarioId)).toEqual([
      two.id,
      one.id,
    ]);
    expect(detail.players.map((player) => player.displayName)).toEqual([
      twoContent.source.player,
      oneContent.source.player,
    ]);
    expectMetadataOnly(detail, owner);
    expect(
      await rpc<PlaylistDetail>(learner.client, "get_library_playlist", {
        p_playlist_id: playlist.id,
      }),
    ).toEqual(detail);
    for (const player of detail.players) {
      const page = await rpc<LibraryPlaylistResponse>(
        guest,
        "list_library_playlists",
        { p_player_id: player.id },
      );
      expect(
        page.playlists.filter((row) => row.id === playlist.id),
      ).toHaveLength(1);
      expect(page.playlists[0].itemCount).toBe(2);
    }
    expect(
      (
        await guest.rpc("start_playlist_training_session", {
          p_request_id: randomUUID(),
          p_playlist_id: playlist.id,
          p_expected_publication_version: detail.publicationVersion,
        })
      ).error,
    ).not.toBeNull();
  });

  it("keeps published order and credit frozen while drafts, profiles, and source players change", async () => {
    const owner = await createVerifiedCreator();
    const originalProfile = await saveProfile(owner, "Original Coach");
    const player = `Historical ${randomUUID()}`;
    const content = validContent();
    content.source.player = player;
    let one = await publishScenarioFixture(owner, content);
    const two = await publishScenarioFixture(owner);
    let playlist = await publishPlaylist(
      owner,
      [selected(one), selected(two)],
      "Original order",
    );
    const old = await rpc<PlaylistDetail>(
      owner.client,
      "get_library_playlist",
      { p_playlist_id: playlist.id },
    );
    const originalSelection = selected(one);
    const changed = structuredClone(one.draft.content);
    changed.source.player = `Replacement ${randomUUID()}`;
    changed.title = "New source title";
    one = await republishScenario(
      owner,
      await saveDraftFixture(owner, one, changed),
    );
    playlist = await savePlaylist(owner, playlist, {
      ...playlist.draft.content,
      title: "New order",
      items: [selected(two), originalSelection],
    });
    expect(playlist.items[1].currentVersion).toBe(
      one.publication.currentVersion,
    );
    expect(playlist.items[1].selection.scenarioVersion).not.toBe(
      one.publication.currentVersion,
    );
    expect(
      await rpc<PlaylistDetail>(owner.client, "get_library_playlist", {
        p_playlist_id: playlist.id,
      }),
    ).toEqual(old);
    const historicalPlayer = old.players.find(
      (item) => item.displayName === player,
    )!;
    expect(
      await rpc(owner.client, "get_library_player", {
        p_player_id: historicalPlayer.id,
      }),
    ).toEqual(historicalPlayer);
    expect(
      (
        await rpc<LibraryPlaylistResponse>(
          owner.client,
          "list_library_playlists",
          { p_player_id: historicalPlayer.id },
        )
      ).playlists.map((item) => item.id),
    ).toContain(playlist.id);
    playlist = await reviewPlaylist(owner, playlist, originalProfile);
    const outdatedReview = publishArgs(playlist);
    const newerProfile = await saveProfile(
      owner,
      "New Coach",
      originalProfile.revision,
    );
    expect(
      (await owner.client.rpc("publish_creator_playlist", outdatedReview)).error
        ?.message,
    ).toBe("REVIEW_REQUIRED");
    expect(
      (
        await owner.client.rpc("review_creator_playlist", {
          p_playlist_id: playlist.id,
          p_request_id: randomUUID(),
          p_expected_revision: playlist.revision,
          p_profile_revision: originalProfile.revision,
          p_checklist: playlistChecklist(),
        })
      ).error?.message,
    ).toBe("CREATOR_PROFILE_CONFLICT");
    playlist = await publishReviewed(
      owner,
      await reviewPlaylist(owner, playlist, newerProfile),
    );
    const latest = await rpc<PlaylistDetail>(
      owner.client,
      "get_library_playlist",
      { p_playlist_id: playlist.id },
    );
    expect(latest.publicationVersion).not.toBe(old.publicationVersion);
    expect(latest.credit.displayName).toBe("New Coach");
    expect(latest.items.map((item) => item.scenarioId)).toEqual([
      two.id,
      one.id,
    ]);
    expect(latest.items[1].title).toBe(old.items[0].title);
    const same = await publishReviewed(
      owner,
      await reviewPlaylist(owner, playlist),
    );
    expect(same.publication.currentVersion).not.toBe(latest.publicationVersion);
  });

  it("permanently blocks a withdrawn publication even when its exact source version returns", async () => {
    const owner = await createVerifiedCreator();
    await saveProfile(owner);
    let scenario = await publishScenarioFixture(owner);
    let playlist = await publishPlaylist(owner, [selected(scenario)]);
    const originalVersion = playlist.publication.currentVersion;
    playlist = await reviewPlaylist(owner, playlist);
    const staleReview = publishArgs(playlist);
    scenario = await withdrawScenario(owner, scenario);
    expect(
      (
        await owner.client.rpc("get_library_playlist", {
          p_playlist_id: playlist.id,
        })
      ).error?.message,
    ).toBe("PLAYLIST_UNAVAILABLE");
    scenario = await republishScenario(owner, scenario);
    expect(scenario.publication.currentVersion).toBe("creator-1");
    const blocked = await rpc<CreatorPlaylistSnapshot>(
      owner.client,
      "get_creator_playlist",
      { p_playlist_id: playlist.id },
    );
    expect(blocked.publication.availability).toBe("blocked");
    expect(blocked.publication.currentVersion).toBe(originalVersion);
    expect(
      (await owner.client.rpc("publish_creator_playlist", staleReview)).error
        ?.message,
    ).toBe("REVIEW_REQUIRED");
    playlist = await publishReviewed(
      owner,
      await reviewPlaylist(owner, blocked),
    );
    expect(playlist.publication.availability).toBe("available");
    expect(playlist.publication.currentVersion).not.toBe(originalVersion);
    const withdrawn = await rpc<PlaylistMutationResponse>(
      owner.client,
      "unpublish_creator_playlist",
      {
        p_playlist_id: playlist.id,
        p_request_id: randomUUID(),
        p_expected_revision: playlist.revision,
      },
    );
    const unavailable = await owner.client.rpc("get_library_playlist", {
      p_playlist_id: playlist.id,
    });
    const unknown = await owner.client.rpc("get_library_playlist", {
      p_playlist_id: randomUUID(),
    });
    expect(unavailable.error).toEqual(unknown.error);
    expect(withdrawn.playlist.review).toBeNull();
  });

  it("preserves retry receipts and filter-bound pagination after anchor withdrawal", async () => {
    const owner = await createVerifiedCreator();
    const request = {
      p_request_id: randomUUID(),
      p_expected_revision: 0,
      p_display_name: "Retry Coach",
    };
    const first = await rpc<CreatorProfileMutationResponse>(
      owner.client,
      "save_creator_profile",
      request,
    );
    expect(
      (
        await rpc<CreatorProfileMutationResponse>(
          owner.client,
          "save_creator_profile",
          request,
        )
      ).replayed,
    ).toBe(true);
    expect(
      (
        await owner.client.rpc("save_creator_profile", {
          ...request,
          p_display_name: "Different Coach",
        })
      ).error?.message,
    ).toBe("IDEMPOTENCY_CONFLICT");
    const source = validContent();
    source.source.player = `Cursor ${randomUUID()}`;
    const scenario = await publishScenarioFixture(owner, source);
    const playlists = [];
    for (let index = 0; index < 3; index++)
      playlists.push(
        await publishPlaylist(
          owner,
          [selected(scenario)],
          `Cursor list ${index}`,
        ),
      );
    const page = await rpc<LibraryPlaylistResponse>(
      owner.client,
      "list_library_playlists",
      { p_query: source.source.player, p_limit: 1 },
    );
    expect(page.nextCursor).toBeTruthy();
    const anchor = playlists.find((item) => item.id === page.playlists[0].id)!;
    await rpc(owner.client, "unpublish_creator_playlist", {
      p_playlist_id: anchor.id,
      p_request_id: randomUUID(),
      p_expected_revision: anchor.revision,
    });
    const next = await rpc<LibraryPlaylistResponse>(
      owner.client,
      "list_library_playlists",
      { p_query: source.source.player, p_limit: 50, p_cursor: page.nextCursor },
    );
    expect(new Set(next.playlists.map((item) => item.id))).toEqual(
      new Set(
        playlists
          .filter((item) => item.id !== anchor.id)
          .map((item) => item.id),
      ),
    );
    expect(
      (
        await owner.client.rpc("list_library_playlists", {
          p_query: "different",
          p_cursor: page.nextCursor,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
    expect(
      (
        await owner.client.rpc("list_creator_playlists", {
          p_cursor: page.nextCursor,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
    expect(first.profile.revision).toBe(1);
  });
});
