import { changeScenarioVisibility } from "@/server/moderation/service";
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
    return changeScenarioVisibility(
      (await context.params).id,
      await readLimitedJsonBody(request, 8_192),
    );
  });
}
