import type { ChallengePreview } from "./challenge";
export type LibraryScenarioPreview = ChallengePreview & {
  provenance: "creator" | "ai-assisted";
  publishedAt: string;
};
export type LibraryListResponse = {
  scenarios: LibraryScenarioPreview[];
  nextCursor: string | null;
};
