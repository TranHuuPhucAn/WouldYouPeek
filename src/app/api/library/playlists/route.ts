import { listPublishedPlaylists } from "@/server/playlists/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const p = readQueryParams(request, ["query", "playerId", "cursor"]);
    return listPublishedPlaylists(
      p.get("query"),
      p.get("playerId"),
      p.get("cursor"),
    );
  });
}
