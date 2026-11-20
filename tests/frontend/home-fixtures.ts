import type { HomePageData, HomeScenarioCard } from "@/contracts/home";
import type { HomeViewer } from "@/components/home/HomePageView";
import { TENZ_PLAYER_ID } from "@/contracts/player";
import { preview } from "./playlist-fixtures";

export function homeScenario(
  overrides: Partial<HomeScenarioCard> = {},
): HomeScenarioCard {
  return {
    id: "bind-clove-smoke-contest",
    title: "Contest the smoke at 35 HP",
    topic: "Risk and support",
    player: { id: TENZ_PLAYER_ID, displayName: "TenZ" },
    map: "Bind",
    agent: "Clove",
    editorialOrigin: "curated",
    provenance: "ai",
    publishedAt: null,
    ...overrides,
  };
}

export function homeData(overrides: Partial<HomePageData> = {}): HomePageData {
  return {
    featured: { status: "ready", data: homeScenario() },
    moments: {
      status: "ready",
      data: [
        homeScenario({
          id: "bind-clove-utility",
          title: "Utility before the next fight",
          topic: "Utility timing",
        }),
        homeScenario({
          id: "bind-clove-advantage",
          title: "Reassess the advantage",
          topic: "Preserving an advantage",
        }),
      ],
    },
    players: {
      status: "ready",
      data: [{ player: homeScenario().player, scenarioCount: 3 }],
    },
    playlists: { status: "ready", data: [preview()] },
    resume: { status: "guest" },
    ...overrides,
  };
}

export function homeViewer(
  overrides: Partial<NonNullable<HomeViewer>> = {},
): NonNullable<HomeViewer> {
  return { role: "learner", emailVerified: true, ...overrides };
}
