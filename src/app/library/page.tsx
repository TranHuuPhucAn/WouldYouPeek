import Link from "next/link";
import { getCurrentAccount } from "@/server/auth/guards";
import { getPlayers } from "@/server/players/service";
import { getActiveSessionSummary } from "@/server/training/service";
import { PlayerLibrary } from "@/components/library/PlayerLibrary";
import { ContinueSessionCard } from "@/components/sessions/ContinueSessionCard";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.query === "string" ? params.query.trim() : "";
  const viewer = await getCurrentAccount();
  const [catalogue, saved] = await Promise.allSettled([
    getPlayers({ query }),
    viewer?.emailVerified ? getActiveSessionSummary() : Promise.resolve(null),
  ]);
  return (
    <main className="page-shell">
      <div className="page-heading">
        <span className="eyebrow">THE SCENARIO LIBRARY</span>
        <h1>Existing scenarios</h1>
        <p>
          Explore player POVs. Make your call before seeing the action and
          analysis.
        </p>
      </div>
      {saved.status === "fulfilled" && saved.value && (
        <ContinueSessionCard session={saved.value} />
      )}
      {saved.status === "rejected" && (
        <p role="status" className="quiet-note">
          Your saved session couldn’t load.{" "}
          <Link href="/history">View history</Link> or{" "}
          <a
            href={
              query ? `/library?query=${encodeURIComponent(query)}` : "/library"
            }
          >
            try again
          </a>
          .
        </p>
      )}
      {catalogue.status === "fulfilled" ? (
        <PlayerLibrary key={query} initial={catalogue.value} query={query} />
      ) : (
        <section className="surface-card creator-empty" role="alert">
          <h2>The library couldn’t load.</h2>
          <p>Please try again. Your saved progress is safe.</p>
          <a
            className="button button-secondary"
            href={
              query ? `/library?query=${encodeURIComponent(query)}` : "/library"
            }
          >
            Retry library
          </a>
          {query && (
            <Link className="text-button" href="/library">
              Clear search
            </Link>
          )}
        </section>
      )}
    </main>
  );
}
