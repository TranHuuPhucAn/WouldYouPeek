import type {
  CreatePlaylistRequest,
  PlaylistCommand,
  PlaylistFilter,
  PublishPlaylistRequest,
  ReviewPlaylistRequest,
  SavePlaylistRequest,
} from "@/contracts/playlist";
import { playlistRequest, requirePlaylistId } from "./playlist-api";
import {
  parseCreatorPlaylistList,
  parseCreatorPlaylistSnapshot,
  parsePlaylistMutationResponse,
  parsePlaylistReviewPreview,
  parsePlaylistScenarioCandidates,
} from "./playlist-validation";
const path = (id: string) => `/api/creator/playlists/${requirePlaylistId(id)}`;
export async function listCreatorPlaylists(
  cursor: string | null = null,
  status: PlaylistFilter = "all",
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ status });
  if (cursor) query.set("cursor", cursor);
  return parseCreatorPlaylistList(
    await playlistRequest(`/api/creator/playlists?${query}`, signal),
  );
}
export async function getCreatorPlaylist(id: string, signal?: AbortSignal) {
  return parseCreatorPlaylistSnapshot(
    await playlistRequest(path(id), signal),
    id,
  );
}
export async function createCreatorPlaylist(
  input: CreatePlaylistRequest,
  signal?: AbortSignal,
) {
  return parsePlaylistMutationResponse(
    await playlistRequest("/api/creator/playlists", signal, "POST", input),
  );
}
export async function saveCreatorPlaylist(
  id: string,
  input: SavePlaylistRequest,
  signal?: AbortSignal,
) {
  return parsePlaylistMutationResponse(
    await playlistRequest(path(id), signal, "PUT", input),
    id,
  );
}
export async function getCreatorPlaylistReview(
  id: string,
  revision: number,
  signal?: AbortSignal,
) {
  return parsePlaylistReviewPreview(
    await playlistRequest(`${path(id)}/review?revision=${revision}`, signal),
    id,
    revision,
  );
}
export async function reviewCreatorPlaylist(
  id: string,
  input: ReviewPlaylistRequest,
  signal?: AbortSignal,
) {
  return parsePlaylistMutationResponse(
    await playlistRequest(`${path(id)}/review`, signal, "POST", input),
    id,
  );
}
export async function publishCreatorPlaylist(
  id: string,
  input: PublishPlaylistRequest,
  signal?: AbortSignal,
) {
  return parsePlaylistMutationResponse(
    await playlistRequest(`${path(id)}/publish`, signal, "POST", input),
    id,
  );
}
export async function unpublishCreatorPlaylist(
  id: string,
  input: PlaylistCommand,
  signal?: AbortSignal,
) {
  return parsePlaylistMutationResponse(
    await playlistRequest(`${path(id)}/unpublish`, signal, "POST", input),
    id,
  );
}
export async function listPlaylistScenarioCandidates(
  query = "",
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ query });
  if (cursor) params.set("cursor", cursor);
  return parsePlaylistScenarioCandidates(
    await playlistRequest(`/api/creator/playlist-scenarios?${params}`, signal),
  );
}
