import { notFound } from "next/navigation";
import { requirePageCreator } from "@/app/protected-page";
import {
  findOwnedPlaylist,
  getPlaylistReviewPreview,
} from "@/server/creator-playlists/service";
import { ApiError } from "@/server/http";
import { PlaylistReview } from "@/components/creator/PlaylistReview";
export default async function CreatorPlaylistReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePageCreator(`/creator/playlists/${id}/review`);
  let initial;
  try {
    initial = await findOwnedPlaylist(id);
  } catch (error) {
    if (
      error instanceof ApiError &&
      ["INVALID_REQUEST", "PLAYLIST_NOT_FOUND"].includes(error.code)
    )
      notFound();
    throw error;
  }
  let initialPreview = null,
    initialError: string | undefined;
  try {
    if (initial.readiness.canReview)
      initialPreview = await getPlaylistReviewPreview(id, initial.revision);
  } catch (error) {
    if (
      error instanceof ApiError &&
      [
        "PLAYLIST_CONFLICT",
        "DRAFT_NOT_READY",
        "CREATOR_PROFILE_CONFLICT",
      ].includes(error.code)
    )
      initialError = "The saved collection changed. Reload its latest review.";
    else throw error;
  }
  return (
    <main className="page-shell">
      <PlaylistReview
        key={`${viewer.id}-${id}`}
        initial={initial}
        initialPreview={initialPreview}
        initialError={initialError}
        viewerId={viewer.id}
      />
    </main>
  );
}
