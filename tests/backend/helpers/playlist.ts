import type { CreatorPlaylistSnapshot } from "@/contracts/playlist";
export const playlistId = "11111111-1111-4111-8111-111111111111";
export const publicationVersion = "22222222-2222-4222-8222-222222222222";
export function playlistSnapshot(): CreatorPlaylistSnapshot {
  return {
    id: playlistId,
    revision: 0,
    draft: {
      revision: 0,
      content: { title: "", description: "", items: [] },
      savedAt: "2026-11-21T00:00:00Z",
    },
    items: [],
    readiness: {
      canReview: false,
      issues: [
        { path: "title", code: "REQUIRED", message: "Add a title." },
        { path: "items", code: "REQUIRED", message: "Choose scenarios." },
      ],
    },
    review: null,
    publication: {
      state: "never_published",
      currentVersion: null,
      publishedAt: null,
      hasUnpublishedChanges: true,
      availability: null,
      issues: [],
    },
    updatedAt: "2026-11-21T00:00:00Z",
  };
}
