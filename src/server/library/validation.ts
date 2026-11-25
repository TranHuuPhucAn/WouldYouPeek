import "server-only";
import { ApiError } from "@/server/http";
import { isScenarioId, normalizeScenarioId } from "@/lib/scenario-id";
import { parseUuid } from "@/server/training/validation";
import { parseCatalogueCursor } from "./cursors";
export function parseLibraryCursor(
  value?: unknown,
  playerId: string | null = null,
) {
  return parseCatalogueCursor(value, "scenarios", playerId);
}
export function parseLibraryScenarioId(value: unknown) {
  if (!isScenarioId(value))
    throw new ApiError("INVALID_REQUEST", "Choose a valid scenario.");
  return normalizeScenarioId(value);
}
export function parseLibraryFilters({
  playerId: rawId,
  cursor: rawCursor,
}: { playerId?: unknown; cursor?: unknown } = {}) {
  const playerId =
    rawId === null || rawId === undefined
      ? null
      : parseUuid(rawId).toLowerCase();
  return { playerId, cursor: parseLibraryCursor(rawCursor, playerId) };
}
