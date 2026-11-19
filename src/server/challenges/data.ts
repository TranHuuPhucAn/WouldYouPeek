import "server-only";
import type {
  AIAnalysis,
  Assessment,
  ChallengeDetail,
  YouTubeChallengeSource,
  ObservedAction,
  YouTubeSegment,
} from "@/contracts/challenge";

export type AuthoredChallenge = Omit<
  ChallengeDetail,
  "options" | "source" | "setup" | "decision"
> & {
  question: string;
  source: YouTubeChallengeSource;
  knownFacts: string[];
  unknowns: string[];
  setup: YouTubeSegment;
  decision: { kind: "paused-video"; atSeconds: number; alt: string };
  options: {
    id: string;
    label: string;
    assessment: Assessment;
    explanation: string;
    acceptableWhen: string[];
    risks: string[];
  }[];
  observedAction: ObservedAction;
  analysis: AIAnalysis;
  takeaway: string;
  reveal: YouTubeSegment;
  outcomeText: string;
  review: {
    reviewedBy: "assistant";
    reviewedAt: string;
    visual: "verified";
    audio: "pending" | "verified";
    embed: "pending" | "verified";
    evidence: string[];
    notes: string[];
  };
};

import fixtures from "../../../supabase/fixtures/demo-scenarios.json";

// The fixture and SQL seed share one canonical authored dataset. Runtime reads use Postgres.
export const CHALLENGES: readonly AuthoredChallenge[] =
  fixtures as AuthoredChallenge[];
