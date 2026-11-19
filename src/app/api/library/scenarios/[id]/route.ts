import { getLibraryScenario } from "@/server/library/service";
import { handleRoute } from "@/server/http";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => getLibraryScenario((await context.params).id));
}
