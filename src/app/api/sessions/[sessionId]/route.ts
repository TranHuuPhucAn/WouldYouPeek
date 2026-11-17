import { getSession } from "@/server/training/service";
import { handleRoute } from "@/server/http";
export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handleRoute(async () => getSession((await context.params).sessionId));
}
