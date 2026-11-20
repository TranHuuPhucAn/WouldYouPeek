import "server-only";
import {
  parseCreatorPlaylistList,
  parseCreatorPlaylistSnapshot,
  parsePlaylistMutationResponse,
  parsePlaylistReviewPreview,
  parsePlaylistScenarioCandidates,
} from "@/lib/client/playlist-validation";
import { ApiError } from "@/server/http";
function safely<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Creator playlists could not be loaded safely.",
    );
  }
}
export const toCreatorPlaylistList = (value: unknown) =>
  safely(() => parseCreatorPlaylistList(value));
export const toCreatorPlaylistSnapshot = (value: unknown, id?: string) =>
  safely(() => parseCreatorPlaylistSnapshot(value, id));
export const toPlaylistMutation = (value: unknown, id?: string) =>
  safely(() => parsePlaylistMutationResponse(value, id));
export const toPlaylistReviewPreview = (
  value: unknown,
  id?: string,
  revision?: number,
) => safely(() => parsePlaylistReviewPreview(value, id, revision));
export const toPlaylistCandidates = (value: unknown) =>
  safely(() => parsePlaylistScenarioCandidates(value));
