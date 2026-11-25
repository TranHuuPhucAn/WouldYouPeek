import Link from "next/link";
import type { PlaylistPreview } from "@/contracts/playlist";
export function PlaylistCard({
  playlist,
  headingLevel = 2,
  prefetch,
}: {
  playlist: PlaylistPreview;
  headingLevel?: 2 | 3;
  prefetch?: boolean;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <article className="surface-card playlist-card">
      <span className="eyebrow">
        {playlist.itemCount}{" "}
        {playlist.itemCount === 1 ? "DECISION" : "DECISIONS"} ·{" "}
        {playlist.credit.kind === "editorial"
          ? "CURATED PLAYLIST"
          : "CREATOR PLAYLIST"}
      </span>
      <Heading>
        <Link href={`/library/playlists/${playlist.id}`} prefetch={prefetch}>
          {playlist.title}
        </Link>
      </Heading>
      <p className="playlist-description">{playlist.description}</p>
      <p className="quiet-note">By {playlist.credit.displayName}</p>
      <ul className="playlist-players" aria-label="Included players">
        {playlist.players.map((player) => (
          <li key={player.id}>
            <Link
              href={`/library/players/${player.id}?view=playlists`}
              prefetch={prefetch}
            >
              {player.displayName}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        className="text-button"
        href={`/library/playlists/${playlist.id}`}
        prefetch={prefetch}
      >
        Explore playlist →
      </Link>
    </article>
  );
}
