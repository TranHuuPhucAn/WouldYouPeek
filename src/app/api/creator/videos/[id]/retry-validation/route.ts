import { retryValidation } from "@/server/video/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    requireSameOrigin(request);
    return retryValidation(
      (await params).id,
      await readLimitedJsonBody(request, 4096),
    );
  });
}
