import { getChallengePreview } from "@/server/challenges/service";
import { handleRoute } from "@/server/http";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () =>
    getChallengePreview((await context.params).id),
  );
}
