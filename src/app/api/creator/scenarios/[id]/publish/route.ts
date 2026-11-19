import { publishScenario } from "@/server/creator/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return publishScenario(
      (await context.params).id,
      await readLimitedJsonBody(request),
    );
  });
}
