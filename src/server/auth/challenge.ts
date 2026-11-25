import "server-only";
import type { AuthChallengeConfig } from "@/contracts/auth";
import { getServerAppConfig } from "@/server/config";
import { ApiError } from "@/server/http";

export function getAuthChallengeConfig(): AuthChallengeConfig {
  const config = getServerAppConfig();
  return config.deploymentMode === "local"
    ? { kind: "none" }
    : { kind: "turnstile", siteKey: config.turnstileSiteKey! };
}

/** Shape validation only. Supabase verifies the single-use challenge token. */
export function parseCaptchaToken(input: unknown): string | undefined {
  const token =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).captchaToken
      : undefined;
  if (getAuthChallengeConfig().kind === "none") return undefined;
  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > 2048 ||
    /\s/.test(token)
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "Complete the security check and try again.",
    );
  return token;
}
