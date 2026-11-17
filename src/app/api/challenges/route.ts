import { listChallenges } from "@/server/challenges/service";
import { handleRoute } from "@/server/http";

export async function GET(): Promise<Response> {
  return handleRoute(() => ({ challenges: listChallenges() }));
}
