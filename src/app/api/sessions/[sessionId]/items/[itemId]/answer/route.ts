import { answerSessionItem } from "@/server/training/service";
import { handleRoute, requireSameOrigin, readJsonBody } from "@/server/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string; itemId: string }> },
) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    const { sessionId, itemId } = await context.params;
    return answerSessionItem(sessionId, itemId, await readJsonBody(request));
  });
}
