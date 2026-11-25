import {
  createPlaylist,
  listOwnedPlaylists,
} from "@/server/creator-playlists/service";
import {
  handleRoute,
  readQueryParams,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const params = readQueryParams(request, ["cursor", "status"]);
    return listOwnedPlaylists(params.get("cursor"), params.get("status"));
  });
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return createPlaylist(await readLimitedJsonBody(request, 16384));
  });
}
