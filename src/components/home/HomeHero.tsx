import Link from "next/link";
import type { HomeScenarioCard, HomeSection } from "@/contracts/home";
import styles from "./home.module.css";

export function HomeHero({
  featured,
}: {
  featured: HomeSection<HomeScenarioCard | null>;
}) {
  return (
    <section className={styles.hero} aria-labelledby="home-feature-heading">
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>
          <span className={styles.coralLine} aria-hidden="true" /> FEATURED
          MOMENT
        </p>
        <h2 id="home-feature-heading">
          A moment worth
          <br className={styles.desktopBreak} /> a second look.
        </h2>
        <p>
          Step into the player’s point of view. Explore the setup before making
          your own call.
        </p>
        <span className={styles.heroNote}>
          The next move is yours to question.
        </span>
      </div>
      {featured.status === "unavailable" ? (
        <div className={styles.featureFallback}>
          <p className={styles.kicker}>FEATURED MOMENT</p>
          <h3>The featured moment couldn’t load.</h3>
          <p>The Library and other collections are still worth exploring.</p>
          <a href="/" className={styles.textLink}>
            Retry featured moment →
          </a>
        </div>
      ) : featured.data ? (
        <HomeMomentCard moment={featured.data} featured />
      ) : (
        <div className={styles.featureFallback}>
          <p className={styles.kicker}>ROOM FOR THE NEXT CALL</p>
          <h3>Published moments will appear here.</h3>
          <p>Visit the Library or bring a moment of your own to study.</p>
          <Link href="/library" prefetch={false} className={styles.textLink}>
            Explore the Library →
          </Link>
        </div>
      )}
    </section>
  );
}

export function HomeMomentCard({
  moment,
  featured = false,
}: {
  moment: HomeScenarioCard;
  featured?: boolean;
}) {
  const metadata = [moment.player.displayName, moment.map, moment.agent].filter(
    Boolean,
  );
  return (
    <article className={featured ? styles.featuredMoment : styles.momentCard}>
      {featured && (
        <div className={styles.slateTopline}>
          <span className={styles.kicker}>PUBLISHED MOMENT</span>
          <span className={styles.pauseMark} aria-hidden="true">
            <i />
            <i />
          </span>
        </div>
      )}
      <div className={styles.momentBody}>
        <p className={styles.topic}>{moment.topic}</p>
        <h3>
          <Link href={`/library/${moment.id}`} prefetch={false}>
            {moment.title}
          </Link>
        </h3>
        <p className={styles.metadata}>{metadata.join(" · ")}</p>
      </div>
      <div className={styles.momentFooter}>
        <p className={styles.attribution}>{homeAnalysisLabel(moment)}</p>
        <Link
          href={`/library/${moment.id}`}
          prefetch={false}
          className={featured ? "button button-primary" : styles.textLink}
          aria-label={`Explore moment: ${moment.title}`}
        >
          Explore moment <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}

function homeAnalysisLabel(moment: HomeScenarioCard) {
  const origin = moment.editorialOrigin === "curated" ? "Curated · " : "";
  const analysis =
    moment.provenance === "ai"
      ? "AI-authored analysis"
      : moment.provenance === "ai-assisted"
        ? "Creator-reviewed · AI-assisted analysis"
        : "Creator-authored analysis";
  return `${origin}${analysis}`;
}
