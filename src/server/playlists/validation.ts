import "server-only";
import { parsePlayerQuery, parsePlayerId } from "@/server/players/validation";
import { parsePlaylistCursor } from "./cursors";
export { parseCreatorId as parsePlaylistId } from "@/server/creator/validation";
export function parsePlaylistFilters(
  query?: unknown,
  playerId?: unknown,
  cursor?: unknown,
) {
  const q = parsePlayerQuery(query);
  const player =
    playerId === undefined || playerId === null
      ? null
      : parsePlayerId(playerId);
  return {
    query: q,
    playerId: player,
    cursor: parsePlaylistCursor(cursor, "library-playlists", {
      query: q,
      playerId: player,
    }),
  };
}
