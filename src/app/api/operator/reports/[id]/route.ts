import { getOperatorReport } from "@/server/moderation/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    return getOperatorReport((await context.params).id);
  });
}
