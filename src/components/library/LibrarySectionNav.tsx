import Link from "next/link";
export function LibrarySectionNav({
  view,
  playerId,
}: {
  view: "scenarios" | "playlists";
  playerId?: string;
}) {
  const base = playerId ? `/library/players/${playerId}` : "/library";
  return (
    <nav className="section-nav" aria-label="Library views">
      <Link
        href={base}
        aria-current={view === "scenarios" ? "page" : undefined}
      >
        Scenarios
      </Link>
      <Link
        href={playerId ? `${base}?view=playlists` : "/library/playlists"}
        aria-current={view === "playlists" ? "page" : undefined}
      >
        Playlists
      </Link>
    </nav>
  );
}
