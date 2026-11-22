import { submitReport } from "@/server/moderation/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    readQueryParams(request, []);
    return submitReport(await readLimitedJsonBody(request, 16_384));
  });
}
