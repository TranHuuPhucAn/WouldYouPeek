import { getLibrary } from "@/server/library/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() =>
    getLibrary(readQueryParams(request, ["cursor"]).get("cursor")),
  );
}
