import { enableCreator } from "@/server/account/service";
import { handleRoute, requireSameOrigin, ApiError } from "@/server/http";

export async function POST(request: Request) {
  return handleRoute(async () => {
    requireSameOrigin(request);
    const body = await request.text();
    if (body.trim()) {
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        throw new ApiError("INVALID_JSON", "Send an empty JSON object.");
      }
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length
      ) {
        throw new ApiError(
          "INVALID_REQUEST",
          "Creator access can only be enabled for your own account, without extra fields.",
        );
      }
    }
    return enableCreator();
  });
}
