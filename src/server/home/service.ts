import "server-only";
import type { AccountUser } from "@/contracts/auth";
import type {
  HomePageData,
  HomeResume,
  HomeScenarioCard,
  HomeSection,
} from "@/contracts/home";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import type { PlayerListResponse } from "@/contracts/player";
import type { LibraryPlaylistResponse } from "@/contracts/playlist";
import type { SessionSummary } from "@/contracts/session";
import { ApiError } from "@/server/http";
import { getLibrary, getLibraryScenario } from "@/server/library/service";
import { getPlayers } from "@/server/players/service";
import { listPublishedPlaylists } from "@/server/playlists/service";
import { getActiveSessionSummary } from "@/server/training/service";
import { HOME_LIMITS, PREFERRED_HOME_SCENARIO_ID } from "./config";
import { toHomePlayerCard, toHomeScenarioCard } from "./projections";

type ReadResult<T> = PromiseSettledResult<T>;

async function loadPreferredScenario() {
  try {
    return await getLibraryScenario(PREFERRED_HOME_SCENARIO_ID);
  } catch (error) {
    if (error instanceof ApiError && error.code === "SCENARIO_UNAVAILABLE")
      return null;
    throw error;
  }
}

function selectFeaturedScenario(
  preferred: ReadResult<LibraryScenarioPreview | null>,
  library: ReadResult<LibraryListResponse>,
): HomeSection<HomeScenarioCard | null> {
  if (preferred.status === "fulfilled" && preferred.value)
    return { status: "ready", data: toHomeScenarioCard(preferred.value) };
  if (library.status === "fulfilled" && library.value.scenarios.length)
    return {
      status: "ready",
      data: toHomeScenarioCard(library.value.scenarios[0]),
    };
  if (preferred.status === "fulfilled" && library.status === "fulfilled")
    return { status: "ready", data: null };
  return { status: "unavailable" };
}

function selectHomeMoments(
  library: ReadResult<LibraryListResponse>,
  featured: HomePageData["featured"],
): HomePageData["moments"] {
  if (library.status === "rejected") return { status: "unavailable" };
  const featuredId = featured.status === "ready" ? featured.data?.id : null;
  return {
    status: "ready",
    data: library.value.scenarios
      .filter((scenario) => scenario.id !== featuredId)
      .slice(0, HOME_LIMITS.moments)
      .map(toHomeScenarioCard),
  };
}

function selectHomePlayers(
  result: ReadResult<PlayerListResponse>,
): HomePageData["players"] {
  if (result.status === "rejected") return { status: "unavailable" };
  return {
    status: "ready",
    data: result.value.players
      .slice(0, HOME_LIMITS.players)
      .map(toHomePlayerCard),
  };
}

function selectHomePlaylists(
  result: ReadResult<LibraryPlaylistResponse>,
): HomePageData["playlists"] {
  if (result.status === "rejected") return { status: "unavailable" };
  return {
    status: "ready",
    data: result.value.playlists.slice(0, HOME_LIMITS.playlists),
  };
}

function selectHomeResume(
  viewer: AccountUser | null,
  result: ReadResult<SessionSummary | null>,
): HomeResume {
  if (!viewer) return { status: "guest" };
  if (!viewer.emailVerified) return { status: "unverified" };
  return result.status === "fulfilled"
    ? { status: "ready", data: result.value }
    : { status: "unavailable" };
}

/** Request-scoped reads only; the private service authorizes with real cookies. */
export async function getHomePageData(
  viewer: AccountUser | null,
): Promise<HomePageData> {
  const [library, players, playlists, preferred, active] =
    await Promise.allSettled([
      getLibrary(),
      getPlayers(),
      listPublishedPlaylists(),
      loadPreferredScenario(),
      viewer?.emailVerified ? getActiveSessionSummary() : Promise.resolve(null),
    ]);
  const featured = selectFeaturedScenario(preferred, library);
  return {
    featured,
    moments: selectHomeMoments(library, featured),
    players: selectHomePlayers(players),
    playlists: selectHomePlaylists(playlists),
    resume: selectHomeResume(viewer, active),
  };
}
