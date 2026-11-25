import { createDraft, listOwnedScenarios } from "@/server/creator/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const params = readQueryParams(request, ["cursor", "status"]);
    return listOwnedScenarios(params.get("cursor"), params.get("status"));
  });
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return createDraft(await readLimitedJsonBody(request));
  });
}
