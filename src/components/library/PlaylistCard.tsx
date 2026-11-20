import Link from "next/link";
import type { PlaylistPreview } from "@/contracts/playlist";
export function PlaylistCard({ playlist }: { playlist: PlaylistPreview }) {
  return (
    <article className="surface-card playlist-card">
      <span className="eyebrow">
        {playlist.itemCount}{" "}
        {playlist.itemCount === 1 ? "DECISION" : "DECISIONS"} ·{" "}
        {playlist.credit.kind === "editorial"
          ? "CURATED PLAYLIST"
          : "CREATOR PLAYLIST"}
      </span>
      <h2>
        <Link href={`/library/playlists/${playlist.id}`}>{playlist.title}</Link>
      </h2>
      <p className="playlist-description">{playlist.description}</p>
      <p className="quiet-note">By {playlist.credit.displayName}</p>
      <ul className="playlist-players" aria-label="Included players">
        {playlist.players.map((player) => (
          <li key={player.id}>
            <Link href={`/library/players/${player.id}?view=playlists`}>
              {player.displayName}
            </Link>
          </li>
        ))}
      </ul>
      <Link className="text-button" href={`/library/playlists/${playlist.id}`}>
        Explore playlist →
      </Link>
    </article>
  );
}
