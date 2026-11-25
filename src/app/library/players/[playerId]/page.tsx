import Link from "next/link";
import { LibrarySectionNav } from "@/components/library/LibrarySectionNav";
import { PlaylistLibrary } from "@/components/library/PlaylistLibrary";
import { listPublishedPlaylists } from "@/server/playlists/service";
import { notFound } from "next/navigation";
import { getPlayer } from "@/server/players/service";
import { getLibrary } from "@/server/library/service";
import { ApiError } from "@/server/http";
import { ScenarioLibrary } from "@/components/library/ScenarioLibrary";
import {
  getPublicPageMetadata,
  getUnavailableMetadata,
} from "@/server/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  try {
    const player = await getPlayer(playerId);
    return player
      ? getPublicPageMetadata({
          title: `${player.displayName} scenarios`,
          path: `/library/players/${player.id}`,
        })
      : getUnavailableMetadata("Player unavailable");
  } catch {
    return getUnavailableMetadata("Player unavailable");
  }
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const { playerId } = await params;
  const query = await searchParams;
  const view = query?.view === "playlists" ? "playlists" : "scenarios";
  let player;
  try {
    player = await getPlayer(playerId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "INVALID_REQUEST")
      notFound();
    throw error;
  }
  if (!player) notFound();
  const initial =
    view === "scenarios" ? await getLibrary({ playerId: player.id }) : null;
  const playlists =
    view === "playlists" ? await listPublishedPlaylists("", player.id) : null;
  return (
    <main className="page-shell">
      <Link href="/library" className="text-button">
        ← All players
      </Link>
      <div className="page-heading">
        <span className="eyebrow">
          {view === "playlists" ? "PLAYLISTS FEATURING" : "PLAYER SCENARIOS"}
        </span>
        <h1>{player.displayName}</h1>
        <p>
          Explore the recording, make your decision, then compare perspectives.
        </p>
      </div>
      <LibrarySectionNav view={view} playerId={player.id} />
      {initial && (
        <ScenarioLibrary
          key={player.id}
          initial={initial}
          playerId={player.id}
        />
      )}
      {playlists && (
        <PlaylistLibrary
          key={player.id}
          initial={playlists}
          playerId={player.id}
        />
      )}
    </main>
  );
}
