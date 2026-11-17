import { getHistory, startSession } from "@/server/training/service";
import { handleRoute, requireSameOrigin, readJsonBody } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() =>
    getHistory(new URL(request.url).searchParams.get("cursor")),
  );
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return startSession(await readJsonBody(request));
  });
}
