import { listChallengePreviews } from "@/server/challenges/service";
import { handleRoute } from "@/server/http";
export async function GET() {
  return handleRoute(async () => ({
    challenges: await listChallengePreviews(),
  }));
}
