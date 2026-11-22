import { resolveOperatorReport } from "@/server/moderation/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    readQueryParams(request, []);
    return resolveOperatorReport(
      (await context.params).id,
      await readLimitedJsonBody(request, 16_384),
    );
  });
}
