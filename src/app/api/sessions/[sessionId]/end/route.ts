import { endSession } from "@/server/training/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return endSession(
      (await context.params).sessionId,
      await readLimitedJsonBody(request, 1_024),
    );
  });
}
