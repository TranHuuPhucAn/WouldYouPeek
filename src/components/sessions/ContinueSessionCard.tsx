import Link from "next/link";
import type { SessionSummary } from "@/contracts/session";

export function ContinueSessionCard({
  session,
  prefetch,
}: {
  session: SessionSummary;
  prefetch?: boolean;
}) {
  return (
    <section
      className="surface-card continue-session"
      aria-label="Saved session"
    >
      <div>
        <span className="eyebrow">CONTINUE YOUR SESSION</span>
        <h2>{session.title}</h2>
        {session.playlist && (
          <p className="quiet-note">
            Playlist by {session.playlist.credit.displayName}
          </p>
        )}
        <p>
          {session.answeredCount} of {session.totalCount} decisions saved.
        </p>
      </div>
      <Link
        href={`/play/${session.id}`}
        prefetch={prefetch}
        className="button button-primary"
      >
        Resume session →
      </Link>
    </section>
  );
}
