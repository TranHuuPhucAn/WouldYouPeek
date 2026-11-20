import Link from "next/link";
import type {
  HomePlayerCard as HomePlayerGroup,
  HomeScenarioCard,
  HomeSection,
} from "@/contracts/home";
import type { PlaylistPreview } from "@/contracts/playlist";
import { PlaylistCard } from "@/components/library/PlaylistCard";
import { HomeMomentCard } from "./HomeHero";
import styles from "./home.module.css";

export function HomePlayerSection({
  section,
}: {
  section: HomeSection<HomePlayerGroup[]>;
}) {
  return (
    <section
      className={styles.collection}
      aria-labelledby="home-players-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>A DIFFERENT PERSPECTIVE</p>
          <h2 id="home-players-heading">Study a player</h2>
        </div>
        <Link href="/library" prefetch={false} className={styles.textLink}>
          View all players →
        </Link>
      </div>
      {section.status === "unavailable" ? (
        <HomeSectionUnavailable label="Player scenarios" />
      ) : section.data.length ? (
        <div className={styles.playerGrid}>
          {section.data.map((group) => (
            <HomePlayerCard key={group.player.id} group={group} />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No player scenarios are published yet.</p>
      )}
    </section>
  );
}

export function HomePlaylistSection({
  section,
}: {
  section: HomeSection<PlaylistPreview[]>;
}) {
  if (section.status === "ready" && !section.data.length) return null;
  return (
    <section
      className={styles.collection}
      aria-labelledby="home-playlists-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>PUT THE MOMENTS TOGETHER</p>
          <h2 id="home-playlists-heading">Playlists to study</h2>
        </div>
        <Link
          href="/library/playlists"
          prefetch={false}
          className={styles.textLink}
        >
          Browse playlists →
        </Link>
      </div>
      {section.status === "unavailable" ? (
        <HomeSectionUnavailable label="Playlists" />
      ) : (
        <div className={styles.playlistGrid}>
          {section.data.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              headingLevel={3}
              prefetch={false}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HomeMomentSection({
  section,
}: {
  section: HomeSection<HomeScenarioCard[]>;
}) {
  if (section.status === "ready" && !section.data.length) return null;
  return (
    <section
      className={styles.collection}
      aria-labelledby="home-moments-heading"
    >
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>MORE CALLS TO MAKE</p>
          <h2 id="home-moments-heading">Explore moments</h2>
        </div>
        <Link href="/library" prefetch={false} className={styles.textLink}>
          Browse scenarios →
        </Link>
      </div>
      {section.status === "unavailable" ? (
        <HomeSectionUnavailable label="More moments" />
      ) : (
        <div className={styles.momentGrid}>
          {section.data.map((moment) => (
            <HomeMomentCard key={moment.id} moment={moment} />
          ))}
        </div>
      )}
    </section>
  );
}

function HomePlayerCard({ group }: { group: HomePlayerGroup }) {
  return (
    <article className={styles.playerCard}>
      <div>
        <p className={styles.kicker}>PLAYER STUDY</p>
        <h3>
          <Link href={`/library/players/${group.player.id}`} prefetch={false}>
            {group.player.displayName} <span aria-hidden="true">↗</span>
          </Link>
        </h3>
      </div>
      <p className={styles.playerCount}>
        <strong>{group.scenarioCount}</strong>{" "}
        {group.scenarioCount === 1 ? "scenario" : "scenarios"}
      </p>
    </article>
  );
}

function HomeSectionUnavailable({ label }: { label: string }) {
  return (
    <div className={styles.sectionNotice}>
      <p>{label} couldn’t load. Try again in a moment.</p>
      <a href="/" className={styles.textLink}>
        Retry {label.toLowerCase()} →
      </a>
    </div>
  );
}
