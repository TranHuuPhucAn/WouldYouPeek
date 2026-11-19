import { advanceSession } from "@/server/training/service";
import { handleRoute, requireSameOrigin, readJsonBody } from "@/server/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return advanceSession(
      (await context.params).sessionId,
      await readJsonBody(request),
    );
  });
}
