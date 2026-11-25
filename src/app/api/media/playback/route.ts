import { issuePlaybackUrl } from "@/server/video/playback";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
export async function POST(request: Request) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    requireSameOrigin(request);
    return issuePlaybackUrl(await readLimitedJsonBody(request, 4096));
  });
}
