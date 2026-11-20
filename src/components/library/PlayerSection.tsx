import Link from "next/link";
import type { PlayerGroup } from "@/contracts/player";
import { ScenarioCard } from "./ScenarioCard";

export function PlayerSection({ group }: { group: PlayerGroup }) {
  return (
    <section
      className="player-section"
      aria-labelledby={`player-${group.player.id}`}
    >
      <div className="player-section-heading">
        <div>
          <h2 id={`player-${group.player.id}`}>{group.player.displayName}</h2>
          <p>
            {group.scenarioCount}{" "}
            {group.scenarioCount === 1 ? "scenario" : "scenarios"}
          </p>
        </div>
        <Link
          className="text-button"
          href={`/library/players/${group.player.id}`}
        >
          View all {group.player.displayName} scenarios →
        </Link>
      </div>
      <div className="library-grid">
        {group.scenarios.map((scenario) => (
          <ScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>
    </section>
  );
}
