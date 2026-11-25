import {
  findOwnedPlaylist,
  savePlaylist,
} from "@/server/creator-playlists/service";
import {
  handleRoute,
  readQueryParams,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    return findOwnedPlaylist((await context.params).id);
  });
}
export async function PUT(request: Request, context: Context) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return savePlaylist(
      (await context.params).id,
      await readLimitedJsonBody(request, 16384),
    );
  });
}
