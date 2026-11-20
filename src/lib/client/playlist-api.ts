import { ApiClientError, readApiResponse } from "./api-response";
import { isUuid } from "./session-api";
import {
  parseLibraryPlaylistResponse,
  parsePlaylistDetail,
} from "./playlist-validation";
export function requirePlaylistId(id: string) {
  if (!isUuid(id))
    throw new ApiClientError(
      "INVALID_REQUEST",
      "This playlist is unavailable.",
      400,
    );
  return encodeURIComponent(id);
}
export async function playlistRequest(
  url: string,
  signal?: AbortSignal,
  method = "GET",
  body?: unknown,
) {
  return readApiResponse(
    await fetch(url, {
      method,
      signal,
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}
export async function listLibraryPlaylists(
  filters: { query?: string; playerId?: string; cursor?: string | null } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (filters.query) query.set("query", filters.query);
  if (filters.playerId) {
    requirePlaylistId(filters.playerId);
    query.set("playerId", filters.playerId);
  }
  if (filters.cursor) query.set("cursor", filters.cursor);
  return parseLibraryPlaylistResponse(
    await playlistRequest(`/api/library/playlists?${query}`, signal),
  );
}
export async function getLibraryPlaylist(id: string, signal?: AbortSignal) {
  return parsePlaylistDetail(
    await playlistRequest(
      `/api/library/playlists/${requirePlaylistId(id)}`,
      signal,
    ),
    id,
  );
}
