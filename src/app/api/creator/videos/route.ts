import { createVideo, listVideos } from "@/server/video/service";
import {
  handleRoute,
  requireSameOrigin,
  readLimitedJsonBody,
  readQueryParams,
} from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    const p = readQueryParams(request, ["cursor"]);
    return listVideos(p.get("cursor"));
  });
}
export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    readQueryParams(request, []);
    return createVideo(await readLimitedJsonBody(request, 4096));
  });
}
