import "server-only";
import { ApiError } from "@/server/http";
import { UUID_PATTERN } from "@/server/training/validation";
export type PlaylistCursorKind =
  "library-playlists" | "creator-playlists" | "playlist-candidates";
export function parsePlaylistCursor(
  value: unknown,
  kind: PlaylistCursorKind,
  filter: Record<string, unknown>,
): string | null {
  if (value === null || value === undefined) return null;
  try {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const c = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !c ||
      typeof c !== "object" ||
      Array.isArray(c) ||
      Object.keys(c).length !== 5 ||
      !["v", "kind", "filter", "at", "id"].every((k) => Object.hasOwn(c, k)) ||
      c.v !== 1 ||
      c.kind !== kind ||
      !c.filter ||
      typeof c.filter !== "object" ||
      Array.isArray(c.filter) ||
      Object.keys(c.filter).length !== Object.keys(filter).length ||
      !Object.keys(filter).every((k) => c.filter[k] === filter[k]) ||
      typeof c.id !== "string" ||
      !UUID_PATTERN.test(c.id) ||
      typeof c.at !== "string" ||
      c.at.length > 50 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        c.at,
      ) ||
      !Number.isFinite(Date.parse(c.at))
    )
      throw new Error();
    return value;
  } catch {
    throw new ApiError(
      "INVALID_REQUEST",
      "The page cursor is invalid for this view.",
    );
  }
}
