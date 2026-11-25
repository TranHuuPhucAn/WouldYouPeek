import { redirect } from "next/navigation";
import { TENZ_PLAYER_ID } from "@/contracts/player";
import { getPlayer } from "@/server/players/service";

export default async function DemoPage() {
  const player = await getPlayer(TENZ_PLAYER_ID);
  redirect(player ? `/library/players/${player.id}` : "/library");
}
