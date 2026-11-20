import type { ChallengeDetail } from "@/contracts/challenge";
import { SourceAttribution } from "./SourceAttribution";

export function ScenarioContext({ challenge }: { challenge: ChallengeDetail }) {
  return (
    <section className="scenario-context" aria-label="The situation">
      <p className="scenario-situation">{challenge.context}</p>
      {!!challenge.knownFacts?.length && (
        <ul className="scenario-facts" aria-label="Player-visible information">
          {challenge.knownFacts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
      {challenge.linkedScenarioId && (
        <p className="linked-note">
          Linked follow-up · Same round, a new balance of risk.
        </p>
      )}
      <div className="scenario-context-details">
        {!!challenge.unknowns?.length && (
          <details>
            <summary>What remains unknown</summary>
            <ul>
              {challenge.unknowns.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </details>
        )}
        {challenge.source && (
          <details>
            <summary>Source &amp; attribution</summary>
            <SourceAttribution source={challenge.source} />
          </details>
        )}
      </div>
      {challenge.mediaStatus === "demo" && (
        <p className="quiet-note">
          Illustrative demo · An original training diagram with an authored
          continuation. Not recorded Valorant footage.
        </p>
      )}
    </section>
  );
}
