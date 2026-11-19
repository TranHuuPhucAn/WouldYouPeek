import { getVideo } from "@/server/video/service";
import { handleRoute, readQueryParams } from "@/server/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    readQueryParams(request, []);
    return getVideo((await params).id);
  });
}
