import Link from "next/link";
import type { HomeViewer } from "./HomePageView";
import styles from "./home.module.css";

export function HomeNextSteps({ viewer }: { viewer: HomeViewer }) {
  return (
    <div className={styles.nextSteps}>
      {!viewer && <HomeGuestGuide />}
      <HomeCreatorInvitation viewer={viewer} />
    </div>
  );
}

function HomeGuestGuide() {
  return (
    <section className={styles.guide} aria-labelledby="home-guide-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>YOUR FIRST SESSION</p>
          <h2 id="home-guide-heading">Watch. Decide. Compare.</h2>
        </div>
        <Link
          href="/sign-in?returnTo=%2Flibrary"
          prefetch={false}
          className={styles.textLink}
        >
          Sign in to play →
        </Link>
      </div>
      <ol className={styles.guideSteps}>
        <li>
          <span className={styles.stepNumber} aria-hidden="true">
            01
          </span>
          <div>
            <h3>Watch the setup.</h3>
            <p>
              Read the player’s information before the video pauses at a
              decision.
            </p>
          </div>
        </li>
        <li>
          <span className={styles.stepNumber} aria-hidden="true">
            02
          </span>
          <div>
            <h3>Make your call.</h3>
            <p>Choose an action before you see what the player does next.</p>
          </div>
        </li>
        <li>
          <span className={styles.stepNumber} aria-hidden="true">
            03
          </span>
          <div>
            <h3>Compare and learn.</h3>
            <p>
              Watch the pro’s action, then explore the analysis and when other
              choices could work.
            </p>
          </div>
        </li>
      </ol>
      <p className={styles.guideNote}>
        Matching the pro is only part of the story. Several choices can be
        defensible.
      </p>
    </section>
  );
}

function HomeCreatorInvitation({ viewer }: { viewer: HomeViewer }) {
  const destination = !viewer
    ? {
        href: "/sign-up?returnTo=%2Faccount",
        label: "Get started as a creator",
      }
    : !viewer.emailVerified
      ? { href: "/check-email?returnTo=%2Faccount", label: "Verify your email" }
      : viewer.role === "creator"
        ? { href: "/creator", label: "Open Creator" }
        : { href: "/account", label: "Create your own scenarios" };
  return (
    <section
      className={styles.creatorInvitation}
      aria-labelledby="home-creator-heading"
    >
      <div>
        <p className={styles.kicker}>BRING YOUR PERSPECTIVE</p>
        <h2 id="home-creator-heading">Have a moment worth studying?</h2>
        <p>
          {viewer && !viewer.emailVerified
            ? "Verify your email to play, save progress, and start creating."
            : "Turn a decision into a scenario. Put your lessons together in a playlist."}
        </p>
      </div>
      <Link
        href={destination.href}
        prefetch={false}
        className="button button-secondary"
      >
        {destination.label} <span aria-hidden="true">↗</span>
      </Link>
    </section>
  );
}
