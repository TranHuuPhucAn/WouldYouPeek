import "server-only";
import { getServerAppConfig } from "@/server/config";

const destinations =
  /^\/(?:play(?:\/[0-9a-f-]{36})?|history|account|creator|demo)$/i;
export function safeReturnTo(value: unknown, fallback = "/play"): string {
  if (typeof value !== "string" || !destinations.test(value)) return fallback;
  return value;
}
export function buildAuthRedirect(
  type: "signup" | "recovery",
  returnTo?: string,
) {
  const result = new URL("/auth/confirm", getServerAppConfig().appOrigin);
  result.searchParams.set(
    "next",
    type === "recovery" ? "/reset-password" : safeReturnTo(returnTo),
  );
  return result.toString();
}
