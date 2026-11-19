import { findVideoRequest } from "@/server/video/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    return findVideoRequest((await params).requestId);
  });
}
