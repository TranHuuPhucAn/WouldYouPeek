import { findOwnedScenario, saveDraft } from "@/server/creator/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return handleRoute(async () => findOwnedScenario((await context.params).id));
}
export async function PUT(request: Request, context: Context) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return saveDraft(
      (await context.params).id,
      await readLimitedJsonBody(request),
    );
  });
}
