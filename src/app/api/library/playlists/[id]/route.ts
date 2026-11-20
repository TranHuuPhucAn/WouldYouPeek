import { getPublishedPlaylist } from "@/server/playlists/service";
import { handleRoute, readQueryParams } from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    return getPublishedPlaylist((await context.params).id);
  });
}
