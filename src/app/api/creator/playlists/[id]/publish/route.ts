import { publishPlaylist } from "@/server/creator-playlists/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return publishPlaylist(
      (await context.params).id,
      await readLimitedJsonBody(request, 16384),
    );
  });
}
