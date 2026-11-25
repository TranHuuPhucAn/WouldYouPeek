import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
import type {
  HomePageData,
  HomeResume as HomeResumeState,
} from "@/contracts/home";
import { ContinueSessionCard } from "@/components/sessions/ContinueSessionCard";
import { HomeHero } from "./HomeHero";
import {
  HomePlayerSection,
  HomePlaylistSection,
  HomeMomentSection,
} from "./HomeCollections";
import { HomeNextSteps } from "./HomeNextSteps";
import styles from "./home.module.css";

export type HomeViewer = Pick<AccountUser, "role" | "emailVerified"> | null;

export function HomePageView({
  data,
  viewer,
}: {
  data: HomePageData;
  viewer: HomeViewer;
}) {
  return (
    <main className={styles.home}>
      <header className={styles.intro}>
        <div>
          <p className={styles.kicker}>
            VALORANT / THE DECISION BEFORE THE PLAY
          </p>
          <h1>
            Your film room<span className={styles.accent}>.</span>
          </h1>
          <p className={styles.introDescription}>
            Study a real moment. Make your call. Compare.
          </p>
        </div>
        <Link href="/library" prefetch={false} className={styles.browseLink}>
          Browse Library <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <HomeResume resume={data.resume} />
      <HomeHero featured={data.featured} />
      <HomePlayerSection section={data.players} />
      <HomePlaylistSection section={data.playlists} />
      <HomeMomentSection section={data.moments} />
      <HomeNextSteps viewer={viewer} />
      <footer className={styles.footer}>
        <span>MAKE THE CALL. THEN LEARN WHY.</span>
        <span>Would You Peek?</span>
      </footer>
    </main>
  );
}

function HomeResume({ resume }: { resume: HomeResumeState }) {
  if (resume.status === "guest" || resume.status === "unverified") return null;
  if (resume.status === "unavailable") {
    return (
      <section className={styles.notice} aria-labelledby="home-resume-error">
        <h2 id="home-resume-error">Your saved session couldn’t load.</h2>
        <p>You can try again or check your session history.</p>
        <div className={styles.noticeActions}>
          <a href="/" className={styles.textLink}>
            Retry saved session →
          </a>
          <Link href="/history" prefetch={false} className={styles.textLink}>
            View History →
          </Link>
        </div>
      </section>
    );
  }
  if (!resume.data) return null;
  return (
    <div className={styles.resume}>
      <ContinueSessionCard session={resume.data} prefetch={false} />
    </div>
  );
}
