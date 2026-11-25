import "server-only";
import * as repository from "./repository";
import { parsePlaylistId, parsePlaylistFilters } from "./validation";
import { toLibraryPlaylists, toPlaylistDetail } from "./projections";
import { ApiError } from "@/server/http";
export async function listPublishedPlaylists(
  query?: string | null,
  playerId?: string | null,
  cursor?: string | null,
) {
  const filters = parsePlaylistFilters(query, playerId, cursor);
  return toLibraryPlaylists(
    await repository.listPublishedPlaylists(
      filters.query,
      filters.playerId,
      filters.cursor,
    ),
  );
}
export async function getPublishedPlaylist(rawId: string) {
  const id = parsePlaylistId(rawId);
  const value = await repository.getPublishedPlaylist(id);
  if (value === null)
    throw new ApiError(
      "PLAYLIST_UNAVAILABLE",
      "This playlist is not available.",
    );
  return toPlaylistDetail(value, id);
}
