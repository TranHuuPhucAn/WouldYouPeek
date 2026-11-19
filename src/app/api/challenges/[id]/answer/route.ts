import { requireVerifiedUser } from "@/server/auth/guards";
import { handleRoute, ApiError } from "@/server/http";
export async function POST() {
  return handleRoute(async () => {
    await requireVerifiedUser();
    throw new ApiError(
      "SESSION_REQUIRED",
      "Start a saved session to answer scenarios.",
    );
  });
}
