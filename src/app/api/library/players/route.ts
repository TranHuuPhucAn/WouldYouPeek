import { getPlayers } from "@/server/players/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const query = readQueryParams(request, ["query", "cursor"]);
    return getPlayers({
      query: query.get("query"),
      cursor: query.get("cursor"),
    });
  });
}
