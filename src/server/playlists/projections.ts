import "server-only";
import {
  parseLibraryPlaylistResponse,
  parsePlaylistDetail,
} from "@/lib/client/playlist-validation";
import { ApiError } from "@/server/http";
export function toLibraryPlaylists(value: unknown) {
  try {
    return parseLibraryPlaylistResponse(value);
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Playlists could not be loaded safely.",
    );
  }
}
export function toPlaylistDetail(value: unknown, id?: string) {
  try {
    return parsePlaylistDetail(value, id);
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "This playlist could not be loaded safely.",
    );
  }
}
