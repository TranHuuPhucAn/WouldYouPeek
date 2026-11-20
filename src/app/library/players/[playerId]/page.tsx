import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayer } from "@/server/players/service";
import { getLibrary } from "@/server/library/service";
import { ApiError } from "@/server/http";
import { ScenarioLibrary } from "@/components/library/ScenarioLibrary";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  let player;
  try {
    player = await getPlayer(playerId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "INVALID_REQUEST")
      notFound();
    throw error;
  }
  if (!player) notFound();
  const initial = await getLibrary({ playerId: player.id });
  return (
    <main className="page-shell">
      <Link href="/library" className="text-button">
        ← All players
      </Link>
      <div className="page-heading">
        <span className="eyebrow">PLAYER SCENARIOS</span>
        <h1>{player.displayName}</h1>
        <p>
          Explore the recording, make your decision, then compare perspectives.
        </p>
      </div>
      <ScenarioLibrary key={player.id} initial={initial} playerId={player.id} />
    </main>
  );
}
