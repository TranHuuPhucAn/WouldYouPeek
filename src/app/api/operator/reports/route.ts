import { getOperatorReports } from "@/server/moderation/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() =>
    getOperatorReports(
      Object.fromEntries(
        readQueryParams(request, ["status", "cursor", "limit"]),
      ),
    ),
  );
}
