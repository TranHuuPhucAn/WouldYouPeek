import type { ChallengeSource } from "@/contracts/challenge";

export function SourceAttribution({ source }: { source: ChallengeSource }) {
  const creditUrl = source.kind === "uploaded" ? source.creditUrl : source.url;
  return (
    <div className="source-attribution">
      <span className="mono">
        {source.player} · {source.agent} · {source.map}
      </span>
      <p>
        Round {source.round} · {source.score} ·{" "}
        {source.side === "attack" ? "Attacking" : "Defending"}
      </p>
      {creditUrl ? (
        <a href={creditUrl} target="_blank" rel="noreferrer">
          Source: {source.uploader} ↗
        </a>
      ) : (
        <p>Source: {source.uploader}</p>
      )}
      <p className="source-note">
        {source.kind === "uploaded"
          ? "Creator-supplied recording"
          : source.matchType === "ranked"
            ? "Ranked player recording"
            : "Tournament recording"}
        . {creditUrl ? "Opening the source can reveal the outcome. " : ""}
        Attribution is supplied with the scenario.
      </p>
    </div>
  );
}
