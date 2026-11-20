import Link from "next/link";
import { getCurrentAccount } from "@/server/auth/guards";
import { getPublishedPlaylist } from "@/server/playlists/service";
import { ApiError } from "@/server/http";
import { PlaylistItemList } from "@/components/creator/PlaylistItemList";
import { SessionStart } from "@/components/sessions/SessionStart";
export default async function LibraryPlaylistPage({
  params,
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;
  let playlist;
  try {
    playlist = await getPublishedPlaylist(playlistId);
  } catch (error) {
    if (
      error instanceof ApiError &&
      [
        "INVALID_REQUEST",
        "PLAYLIST_UNAVAILABLE",
        "PLAYLIST_NOT_FOUND",
      ].includes(error.code)
    )
      return (
        <main className="page-shell">
          <h1>This playlist is unavailable.</h1>
          <p>Your existing saved sessions remain in History.</p>
          <Link href="/library/playlists" className="button button-secondary">
            Browse playlists
          </Link>
          <Link href="/history" className="text-button">
            View saved sessions
          </Link>
        </main>
      );
    throw error;
  }
  const viewer = await getCurrentAccount();
  return (
    <main className="page-shell">
      <Link href="/library/playlists" className="text-button">
        ← All playlists
      </Link>
      <div className="page-heading">
        <span className="eyebrow">
          {playlist.credit.kind === "editorial"
            ? "CURATED PLAYLIST"
            : "CREATOR PLAYLIST"}
        </span>
        <h1>{playlist.title}</h1>
        <p className="playlist-description">{playlist.description}</p>
        <p>
          By {playlist.credit.displayName} · {playlist.itemCount}{" "}
          {playlist.itemCount === 1 ? "scenario" : "scenarios"}
        </p>
        <ul className="playlist-players" aria-label="Included players">
          {playlist.players.map((player) => (
            <li key={player.id}>
              <Link href={`/library/players/${player.id}?view=playlists`}>
                {player.displayName}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {playlist.players.length > 1 && (
        <p className="surface-card quiet-note">
          This playlist includes several players. Starting it plays all
          scenarios in the order shown.
        </p>
      )}
      <h2>The sequence</h2>
      <PlaylistItemList items={playlist.items} />
      <SessionStart
        key={`${viewer?.id ?? "guest"}-${playlist.id}-${playlist.publicationVersion}`}
        target={{ kind: "playlist", playlistId: playlist.id }}
        expectedPublicationVersion={playlist.publicationVersion}
        viewer={viewer}
        returnTo={`/library/playlists/${playlist.id}`}
      />
    </main>
  );
}
