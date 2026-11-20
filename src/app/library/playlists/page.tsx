import Link from "next/link";
import { getCurrentAccount } from "@/server/auth/guards";
import { getActiveSessionSummary } from "@/server/training/service";
import { listPublishedPlaylists } from "@/server/playlists/service";
import { LibrarySectionNav } from "@/components/library/LibrarySectionNav";
import { PlaylistLibrary } from "@/components/library/PlaylistLibrary";
import { ContinueSessionCard } from "@/components/sessions/ContinueSessionCard";
export default async function LibraryPlaylistsPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  const params = await searchParams,
    query = typeof params.query === "string" ? params.query.trim() : "";
  const viewer = await getCurrentAccount();
  const [catalogue, saved] = await Promise.allSettled([
    listPublishedPlaylists(query),
    viewer?.emailVerified ? getActiveSessionSummary() : Promise.resolve(null),
  ]);
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">THE PLAYLIST LIBRARY</span>
        <h1>A sequence worth studying.</h1>
        <p>
          Explore creator collections and make each decision in their chosen
          order.
        </p>
      </div>
      <LibrarySectionNav view="playlists" />
      {saved.status === "fulfilled" && saved.value && (
        <ContinueSessionCard session={saved.value} />
      )}{" "}
      {saved.status === "rejected" && (
        <p role="status">
          Your saved session couldn’t load.{" "}
          <Link href="/history">View history</Link>.
        </p>
      )}
      {catalogue.status === "fulfilled" ? (
        <PlaylistLibrary key={query} initial={catalogue.value} query={query} />
      ) : (
        <section className="surface-card creator-empty" role="alert">
          <h2>Playlists couldn’t load.</h2>
          <a
            className="button button-secondary"
            href={
              query
                ? `/library/playlists?query=${encodeURIComponent(query)}`
                : "/library/playlists"
            }
          >
            Retry playlists
          </a>
          {query && (
            <Link className="text-button" href="/library/playlists">
              Clear search
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
