import { getReviewPreview, recordReview } from "@/server/creator/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleRoute(async () =>
    getReviewPreview(
      (await context.params).id,
      readQueryParams(request, ["revision"]).get("revision"),
    ),
  );
}
export async function POST(request: Request, context: Context) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return recordReview(
      (await context.params).id,
      await readLimitedJsonBody(request),
    );
  });
}
