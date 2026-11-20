import { requirePageCreator } from "@/app/protected-page";
import { listOwnedPlaylists } from "@/server/creator-playlists/service";
import { PlaylistDashboard } from "@/components/creator/PlaylistDashboard";
export default async function CreatorPlaylistsPage() {
  const viewer = await requirePageCreator("/creator/playlists");
  const initial = await listOwnedPlaylists();
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">CREATOR PLAYLISTS</span>
        <h1>Give your scenarios a sequence.</h1>
        <p>
          Build collections from your published scenarios, featuring one player
          or several.
        </p>
      </div>
      <PlaylistDashboard key={viewer.id} initial={initial} />
    </main>
  );
}
