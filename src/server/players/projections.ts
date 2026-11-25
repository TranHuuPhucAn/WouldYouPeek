import "server-only";
import type { PlayerGroup, PlayerListResponse } from "@/contracts/player";
import { ApiError } from "@/server/http";
import { toLibraryPreview } from "@/server/library/projections";
import { toPlayerSummary } from "./summary";
export { toPlayerSummary } from "./summary";
function invalid(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "The player catalogue could not be loaded safely.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function toPlayerGroup(value: unknown): PlayerGroup {
  const v = record(value),
    player = toPlayerSummary(v.player);
  if (
    !Number.isSafeInteger(v.scenarioCount) ||
    Number(v.scenarioCount) < 1 ||
    !Array.isArray(v.scenarios) ||
    v.scenarios.length < 1 ||
    v.scenarios.length > 3 ||
    v.scenarios.length > Number(v.scenarioCount)
  )
    invalid();
  const scenarios = v.scenarios.map(toLibraryPreview);
  if (
    new Set(scenarios.map((s) => s.id)).size !== scenarios.length ||
    scenarios.some(
      (s) =>
        s.player.id !== player.id ||
        s.player.displayName !== player.displayName,
    )
  )
    invalid();
  return { player, scenarioCount: v.scenarioCount as number, scenarios };
}
export function toPlayerList(value: unknown): PlayerListResponse {
  const v = record(value);
  if (
    !Array.isArray(v.players) ||
    v.players.length > 50 ||
    !(
      v.nextCursor === null ||
      (typeof v.nextCursor === "string" &&
        v.nextCursor.length > 0 &&
        v.nextCursor.length <= 1024 &&
        /^[A-Za-z0-9_-]+$/.test(v.nextCursor))
    )
  )
    invalid();
  const players = v.players.map(toPlayerGroup);
  if (new Set(players.map((p) => p.player.id)).size !== players.length)
    invalid();
  return { players, nextCursor: v.nextCursor as string | null };
}
