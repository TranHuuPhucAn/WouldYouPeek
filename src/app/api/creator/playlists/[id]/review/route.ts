import {
  getPlaylistReviewPreview,
  recordPlaylistReview,
} from "@/server/creator-playlists/service";
import {
  handleRoute,
  readQueryParams,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleRoute(async () =>
    getPlaylistReviewPreview(
      (await context.params).id,
      readQueryParams(request, ["revision"]).get("revision"),
    ),
  );
}
export async function POST(request: Request, context: Context) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return recordPlaylistReview(
      (await context.params).id,
      await readLimitedJsonBody(request, 16384),
    );
  });
}
