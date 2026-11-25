import { notFound } from "next/navigation";
import { requirePageCreator } from "@/app/protected-page";
import {
  findOwnedPlaylist,
  listSelectableScenarios,
} from "@/server/creator-playlists/service";
import { getCreatorProfile } from "@/server/account/creator-profile/service";
import { ApiError } from "@/server/http";
import { PlaylistEditor } from "@/components/creator/PlaylistEditor";
export default async function CreatorPlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePageCreator(`/creator/playlists/${id}`);
  try {
    const [initial, initialCandidates, profile] = await Promise.all([
      findOwnedPlaylist(id),
      listSelectableScenarios(),
      getCreatorProfile(),
    ]);
    return (
      <main className="page-shell">
        <PlaylistEditor
          key={`${viewer.id}-${id}`}
          initial={initial}
          initialCandidates={initialCandidates}
          profile={profile}
          viewerId={viewer.id}
        />
      </main>
    );
  } catch (error) {
    if (
      error instanceof ApiError &&
      ["INVALID_REQUEST", "PLAYLIST_NOT_FOUND"].includes(error.code)
    )
      notFound();
    throw error;
  }
}
