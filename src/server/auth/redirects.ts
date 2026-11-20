import "server-only";
import { getServerAppConfig } from "@/server/config";
import { isScenarioId } from "@/lib/scenario-id";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entryPaths = new Set([
  "/",
  "/library",
  "/play",
  "/history",
  "/account",
  "/creator",
  "/creator/videos",
  "/demo",
]);
function isReturnPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  if (entryPaths.has(value)) return true;
  const parts = value.split("/");
  if (parts[0] !== "") return false;
  if (parts.length === 3 && parts[1] === "play") return uuid.test(parts[2]);
  if (parts.length === 3 && parts[1] === "library")
    return (
      !["players", "playlists"].includes(parts[2]) && isScenarioId(parts[2])
    );
  if (parts.length === 4 && parts[1] === "library" && parts[2] === "players")
    return uuid.test(parts[3]);
  return (
    (parts.length === 4 || (parts.length === 5 && parts[4] === "review")) &&
    parts[1] === "creator" &&
    parts[2] === "scenarios" &&
    uuid.test(parts[3])
  );
}
export function safeReturnTo(value: unknown, fallback = "/library"): string {
  if (isReturnPath(value)) return value;
  return isReturnPath(fallback) ? fallback : "/library";
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
