import { listSelectableScenarios } from "@/server/creator-playlists/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const p = readQueryParams(request, ["query", "cursor"]);
    return listSelectableScenarios(p.get("query"), p.get("cursor"));
  });
}
