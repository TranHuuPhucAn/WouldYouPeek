import type { LibraryScenarioPreview } from "./library";

export const TENZ_PLAYER_ID = "76af0a04-4751-4d26-9233-183a252e124b";
export type PlayerSummary = { id: string; displayName: string };
export type PlayerGroup = {
  player: PlayerSummary;
  scenarioCount: number;
  scenarios: LibraryScenarioPreview[];
};
export type PlayerListResponse = {
  players: PlayerGroup[];
  nextCursor: string | null;
};
