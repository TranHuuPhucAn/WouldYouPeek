import Link from "next/link";
import { getServerAppConfig } from "@/server/config";
import { getPublicPageMetadata } from "@/server/metadata";

export function generateMetadata() {
  return getPublicPageMetadata({
    title: "Help",
    path: "/help",
    description:
      "How to practice, create scenarios and get help with Would You Peek?",
  });
}

export default function HelpPage() {
  const { supportEmail, releaseEnvironment } = getServerAppConfig();
  return (
    <main className="page-shell information-page">
      <div className="page-heading">
        <span className="eyebrow">YOUR NEXT STEP</span>
        <h1>A little context helps.</h1>
        <p>Find a recording, make your call, then compare the possibilities.</p>
      </div>
      <section className="surface-card">
        <h2>Watch. Decide. Compare.</h2>
        <p>
          Browse the <Link href="/library">Library</Link> by player or choose a
          playlist. Sign in with a verified email to play and save your
          progress. Watch the setup, choose an answer at the pause, then see the
          pro’s action and the analysis below it.
        </p>
        <p>
          Matching the pro is a comparison, not a skill score. Check the
          acceptable alternatives and the explanation’s attribution; a pro can
          make a mistake, and an authored explanation is not a direct statement
          from the player.
        </p>
      </section>
      <section className="surface-card">
        <h2>Your decisions stay with you.</h2>
        <p>
          Leaving a page keeps an unfinished session available to resume from
          Home, Library or <Link href="/history">History</Link>. One session can
          be active at a time. Ending it early permanently closes that run and
          keeps the answers you submitted. Unanswered scenarios remain
          unanswered.
        </p>
        <p>
          Saved answers show their analysis immediately, with optional video
          replay. Playlists follow their original order and keep the versions
          you started with.
        </p>
      </section>
      <section className="surface-card">
        <h2>Bring your own perspective.</h2>
        <p>
          Enable creator access in <Link href="/account">Account</Link>. Add a
          YouTube recording, credit the player and source, mark the setup,
          decision pause and continuation, then write the choices and
          explanations. Review your saved scenario before publishing. You can
          organize your published scenarios into ordered playlists, including
          different players.
        </p>
        {releaseEnvironment === "local" && (
          <p>
            This local installation can also support uploaded recordings when
            its media validator is configured. Uploads are unavailable on the
            hosted site.
          </p>
        )}
      </section>
      <section className="surface-card">
        <h2>When something doesn’t work</h2>
        <p>
          If playback is blocked, try the player’s retry or play control and
          check your connection. A source video may become unavailable. Saved
          answer analysis remains readable without replaying the video.
        </p>
        <p>
          Use <strong>Report a problem</strong> on a scenario or saved review to
          flag playback, timing, context or explanation issues. Reports go to
          the project operator; creator access does not grant moderation powers.
        </p>
        <p>
          For account emails, check spam and request a fresh verification or
          reset link. A security check may need retrying if a browser extension
          blocks it. If sending is temporarily limited, wait before retrying.
        </p>
      </section>
      <section className="surface-card">
        <h2>Contact</h2>
        {supportEmail ? (
          <p>
            For account access, data requests or a problem you cannot report in
            the app, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            . Describe what happened and the page involved. Never send your
            password or an email verification/reset link.
          </p>
        ) : (
          <p>
            This local installation has no support email configured. Contact the
            person running it. A monitored support address is required before
            public launch.
          </p>
        )}
      </section>
    </main>
  );
}
