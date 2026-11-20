import type { ChallengePreview } from "./challenge";
import type { PlayerSummary } from "./player";
export type LibraryScenarioPreview = ChallengePreview & {
  player: PlayerSummary;
  editorialOrigin: "curated" | "creator";
  provenance: "ai" | "creator" | "ai-assisted";
  publishedAt: string | null;
};
export type LibraryListResponse = {
  scenarios: LibraryScenarioPreview[];
  nextCursor: string | null;
};
