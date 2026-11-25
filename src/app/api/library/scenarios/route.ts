import { getLibrary } from "@/server/library/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const query = readQueryParams(request, ["playerId", "cursor"]);
    return getLibrary({
      playerId: query.get("playerId"),
      cursor: query.get("cursor"),
    });
  });
}
