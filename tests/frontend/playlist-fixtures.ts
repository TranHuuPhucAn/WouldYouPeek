import type {
  CreatorPlaylistSnapshot,
  PlaylistItemPreview,
  PlaylistReviewPreview,
  PlaylistDetail,
  PlaylistPreview,
} from "@/contracts/playlist";
import { PLAYLIST_REVIEW_CHECKLIST_KEYS } from "@/contracts/playlist";
import { snapshot } from "./session-fixtures";
export const playlistId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const publicationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const reviewId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const when = "2026-11-20T00:00:00.000Z";
export const credit = {
  kind: "creator" as const,
  displayName: "Coach Example",
};
export function candidate(index = 0): PlaylistItemPreview {
  return {
    scenarioId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    scenarioVersion: "creator-1",
    title: `Decision ${index + 1}`,
    topic: "Taking space",
    player: {
      id: `10000000-0000-4000-8000-${String(index % 2).padStart(12, "0")}`,
      displayName: index % 2 ? "aspas" : "TenZ",
    },
    map: "Bind",
    agent: "Clove",
    sourceKind: "youtube",
    provenance: "creator",
  };
}
export const checklist = () =>
  Object.fromEntries(
    PLAYLIST_REVIEW_CHECKLIST_KEYS.map((key) => [key, true]),
  ) as Record<(typeof PLAYLIST_REVIEW_CHECKLIST_KEYS)[number], boolean>;
export function playlistSnapshot(
  count = 2,
  reviewed = false,
): CreatorPlaylistSnapshot {
  const items = Array.from({ length: count }, (_, i) => candidate(i));
  return {
    id: playlistId,
    revision: reviewed ? 2 : 1,
    draft: {
      revision: 1,
      content: {
        title: "Taking space together",
        description: "Two different perspectives.",
        items: items.map(({ scenarioId, scenarioVersion }) => ({
          scenarioId,
          scenarioVersion,
        })),
      },
      savedAt: when,
    },
    items: items.map((preview, position) => ({
      position,
      selection: {
        scenarioId: preview.scenarioId,
        scenarioVersion: preview.scenarioVersion,
      },
      preview,
      currentVersion: preview.scenarioVersion,
      issues: [],
    })),
    readiness: {
      canReview: count > 0,
      issues: count
        ? []
        : [{ path: "items", code: "REQUIRED", message: "Choose a scenario." }],
    },
    review: reviewed
      ? {
          id: reviewId,
          draftRevision: 1,
          profileRevision: 1,
          reviewedAt: when,
          checklist: checklist(),
        }
      : null,
    publication: {
      state: "never_published",
      currentVersion: null,
      publishedAt: null,
      hasUnpublishedChanges: true,
      availability: null,
      issues: [],
    },
    updatedAt: when,
  };
}
export function reviewPreview(
  playlist = playlistSnapshot(),
): PlaylistReviewPreview {
  return {
    playlist,
    credit,
    profileRevision: 1,
    items: playlist.items.map((item) => item.preview!),
  };
}
export function detail(count = 2): PlaylistDetail {
  const items = Array.from({ length: count }, (_, i) => candidate(i));
  return {
    id: playlistId,
    publicationVersion: publicationId,
    title: "Taking space together",
    description: "Two different perspectives.",
    credit,
    players: [
      ...new Map(items.map((item) => [item.player.id, item.player])).values(),
    ],
    itemCount: count,
    publishedAt: when,
    items,
  };
}
export function preview(): PlaylistPreview {
  const { items, ...rest } = detail();
  void items;
  return rest;
}
export function playlistSession() {
  const s = snapshot();
  s.target = { kind: "playlist", playlistId };
  s.playlist = {
    publicationVersion: publicationId,
    credit,
    players: detail().players,
  };
  s.title = "Taking space together";
  return s;
}
