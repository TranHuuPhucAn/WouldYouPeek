import {
  getCreatorProfile,
  saveCreatorProfile,
} from "@/server/account/creator-profile/service";
import {
  handleRoute,
  readQueryParams,
  requireSameOrigin,
  readLimitedJsonBody,
} from "@/server/http";
export async function GET(request: Request) {
  return handleRoute(() => {
    readQueryParams(request, []);
    return getCreatorProfile();
  });
}
export async function PUT(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    return saveCreatorProfile(await readLimitedJsonBody(request, 4096));
  });
}
