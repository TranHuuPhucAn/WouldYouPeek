import "server-only";
import { requireCreator } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
import { parsePlayerQuery } from "@/server/players/validation";
import { parsePlaylistCursor } from "@/server/playlists/cursors";
import * as repository from "./repository";
import * as validation from "./validation";
import * as projections from "./projections";
export async function listOwnedPlaylists(
  cursor?: string | null,
  status?: string | null,
) {
  await requireCreator();
  const filter = validation.parseCreatorFilter(status);
  return projections.toCreatorPlaylistList(
    await repository.listOwnedPlaylists(
      filter,
      parsePlaylistCursor(cursor, "creator-playlists", { status: filter }),
    ),
  );
}
export async function findOwnedPlaylist(rawId: string) {
  await requireCreator();
  const id = validation.parsePlaylistId(rawId);
  const value = await repository.findOwnedPlaylist(id);
  if (value === null)
    throw new ApiError(
      "PLAYLIST_NOT_FOUND",
      "This playlist could not be found.",
    );
  return projections.toCreatorPlaylistSnapshot(value, id);
}
export async function listSelectableScenarios(
  query?: string | null,
  cursor?: string | null,
) {
  await requireCreator();
  const q = parsePlayerQuery(query);
  return projections.toPlaylistCandidates(
    await repository.listSelectableScenarios(
      q,
      parsePlaylistCursor(cursor, "playlist-candidates", { query: q }),
    ),
  );
}
export async function createPlaylist(value: unknown) {
  await requireCreator();
  const command = validation.parseCreatePlaylist(value);
  return projections.toPlaylistMutation(
    await repository.createPlaylist(command.requestId),
  );
}
export async function savePlaylist(rawId: string, value: unknown) {
  await requireCreator();
  const id = validation.parsePlaylistId(rawId),
    command = validation.parseSavePlaylist(value);
  return projections.toPlaylistMutation(
    await repository.savePlaylist(id, command),
    id,
  );
}
export async function getPlaylistReviewPreview(
  rawId: string,
  rawRevision: unknown,
) {
  await requireCreator();
  const id = validation.parsePlaylistId(rawId),
    revision = validation.parseReviewRevision(rawRevision);
  return projections.toPlaylistReviewPreview(
    await repository.getPlaylistReviewPreview(id, revision),
    id,
    revision,
  );
}
export async function recordPlaylistReview(rawId: string, value: unknown) {
  await requireCreator();
  const id = validation.parsePlaylistId(rawId),
    command = validation.parseReviewPlaylist(value);
  return projections.toPlaylistMutation(
    await repository.recordPlaylistReview(id, command),
    id,
  );
}
export async function publishPlaylist(rawId: string, value: unknown) {
  await requireCreator();
  const id = validation.parsePlaylistId(rawId),
    command = validation.parsePublishCommand(value);
  return projections.toPlaylistMutation(
    await repository.publishPlaylist(id, command),
    id,
  );
}
export async function unpublishPlaylist(rawId: string, value: unknown) {
  await requireCreator();
  const id = validation.parsePlaylistId(rawId),
    command = validation.parseUnpublishCommand(value);
  return projections.toPlaylistMutation(
    await repository.unpublishPlaylist(id, command),
    id,
  );
}
