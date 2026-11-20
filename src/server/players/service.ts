import "server-only";
import { ApiError } from "@/server/http";
import {
  parsePlayerId,
  parsePlayerQuery,
  parsePlayerCursor,
} from "./validation";
import { toPlayerSummary, toPlayerList } from "./projections";
import * as repository from "./repository";
export async function getPlayers({
  query: rawQuery,
  cursor: rawCursor,
}: { query?: unknown; cursor?: unknown } = {}) {
  const query = parsePlayerQuery(rawQuery),
    cursor = parsePlayerCursor(rawCursor, query);
  return toPlayerList(await repository.listPlayerGroups({ query, cursor }));
}
export async function getPlayer(rawId: unknown) {
  const id = parsePlayerId(rawId),
    data = await repository.findPlayer(id);
  if (data === null) return null;
  const result = toPlayerSummary(data);
  if (result.id !== id)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The player could not be loaded safely.",
    );
  return result;
}
