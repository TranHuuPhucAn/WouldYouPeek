import "server-only";
import { ApiError } from "@/server/http";
import { parseUuid } from "@/server/training/validation";
import { normalizePlayerKey } from "@/lib/players/identity";
import { parseCatalogueCursor } from "@/server/library/cursors";
export function parsePlayerId(value: unknown): string {
  return parseUuid(value).toLowerCase();
}
export function parsePlayerQuery(value?: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  try {
    if (typeof value !== "string" || value.length > 800) throw new Error();
    if (
      !value
        .normalize("NFKC")
        .replace(
          /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g,
          "",
        )
    )
      return "";
    const query = normalizePlayerKey(value);
    if ([...query].length > 100) throw new Error();
    return query;
  } catch {
    throw new ApiError(
      "INVALID_REQUEST",
      "Search with a player name of at most 100 characters.",
    );
  }
}
export function parsePlayerCursor(value: unknown, query = "") {
  return parseCatalogueCursor(value, "players", query);
}
