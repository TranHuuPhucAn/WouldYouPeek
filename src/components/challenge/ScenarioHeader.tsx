import Link from "next/link";
import type { Ref } from "react";
import type { ChallengeDetail } from "@/contracts/challenge";
import type { PlaylistSessionMetadata } from "@/contracts/playlist";

export type ScenarioPhase =
  "setup" | "decision" | "saving" | "continuation" | "analysis";

export function ScenarioHeader({
  challenge,
  phase,
  index,
  total,
  title,
  playlist,
  headingRef,
  preview = false,
}: {
  challenge: ChallengeDetail;
  phase: ScenarioPhase;
  index?: number;
  total?: number;
  title?: string;
  playlist?: PlaylistSessionMetadata;
  headingRef?: Ref<HTMLHeadingElement>;
  preview?: boolean;
}) {
  const source = challenge.source;
  const step =
    phase === "setup" ? 0 : phase === "decision" || phase === "saving" ? 1 : 2;
  const label = {
    setup: "Watch the setup",
    decision: "Decision paused",
    saving: "Saving your choice",
    continuation: "Watch the continuation",
    analysis: "Review the analysis",
  }[phase];
  const Heading = preview ? "h2" : "h1";
  return (
    <header className="scenario-heading">
      {!preview && (
        <div className="scenario-topline">
          <Link className="text-button" href="/library">
            ← Library
          </Link>
          <span
            className="mono"
            aria-label={`Scenario ${(index ?? 0) + 1} of ${total}`}
          >
            Scenario {(index ?? 0) + 1} of {total}
          </span>
        </div>
      )}
      <p className="scenario-metadata mono">
        {source
          ? [
              source.player,
              source.map,
              source.agent,
              `Round ${source.round}`,
              source.side === "attack" ? "Attack" : "Defense",
              source.score,
            ].join(" / ")
          : challenge.topic}
      </p>
      <Heading ref={headingRef} tabIndex={-1}>
        {challenge.title}
      </Heading>
      {title && (
        <p className="playlist-session-context">
          {title}
          {playlist && <span> · By {playlist.credit.displayName}</span>}
        </p>
      )}
      <ol className="scenario-phases" aria-label={label}>
        {["Watch", "Decide", "Review"].map((name, position) => (
          <li
            key={name}
            aria-current={position === step ? "step" : undefined}
            className={position < step ? "is-done" : undefined}
          >
            <span aria-hidden="true">{position < step ? "✓ " : ""}</span>
            {name}
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status">
        {label}
      </p>
    </header>
  );
}
