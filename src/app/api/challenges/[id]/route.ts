import { getChallenge } from "@/server/challenges/service";
import { handleRoute } from "@/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    return getChallenge(id);
  });
}
