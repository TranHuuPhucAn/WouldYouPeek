import type { PlayerSummary } from "./player";
import type { PlaylistPreview } from "./playlist";
import type { SessionSummary } from "./session";

export type HomeSection<T> =
  { status: "ready"; data: T } | { status: "unavailable" };

export type HomeScenarioCard = {
  id: string;
  title: string;
  topic: string;
  player: PlayerSummary;
  map: string | null;
  agent: string | null;
  editorialOrigin: "curated" | "creator";
  provenance: "ai" | "creator" | "ai-assisted";
  publishedAt: string | null;
};

export type HomePlayerCard = {
  player: PlayerSummary;
  scenarioCount: number;
};

export type HomeResume =
  | { status: "guest" }
  | { status: "unverified" }
  | HomeSection<SessionSummary | null>;

export type HomePageData = {
  featured: HomeSection<HomeScenarioCard | null>;
  moments: HomeSection<HomeScenarioCard[]>;
  players: HomeSection<HomePlayerCard[]>;
  playlists: HomeSection<PlaylistPreview[]>;
  resume: HomeResume;
};
