import "server-only";
import {
  PLAYLIST_REVIEW_CHECKLIST_KEYS,
  type PlaylistDraftContent,
  type SavePlaylistRequest,
  type ReviewPlaylistRequest,
  type PlaylistReviewChecklist,
} from "@/contracts/playlist";
import { commandObject, parseRevision } from "@/server/creator/validation";
import { parseUuid } from "@/server/training/validation";
import {
  normalizePlaylistDraft,
  validatePlaylistDraft,
} from "@/lib/playlists/content";
import { ApiError } from "@/server/http";
export {
  parseCreateDraft as parseCreatePlaylist,
  parsePublishCommand,
  parseUnpublishCommand,
  parseReviewRevision,
  parseCreatorFilter,
  parseCreatorId as parsePlaylistId,
} from "@/server/creator/validation";
export function parseSavePlaylist(value: unknown): SavePlaylistRequest {
  const input = commandObject(value, [
    "requestId",
    "expectedRevision",
    "content",
  ]);
  const issues = validatePlaylistDraft(input.content);
  if (issues.length)
    throw new ApiError(
      "INVALID_REQUEST",
      "Correct the indicated playlist fields.",
      { issues },
    );
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
    content: normalizePlaylistDraft(input.content as PlaylistDraftContent),
  };
}
export function parseReviewPlaylist(value: unknown): ReviewPlaylistRequest {
  const input = commandObject(value, [
    "requestId",
    "expectedRevision",
    "profileRevision",
    "checklist",
  ]);
  const checklist = commandObject(input.checklist, [
    ...PLAYLIST_REVIEW_CHECKLIST_KEYS,
  ]);
  if (!PLAYLIST_REVIEW_CHECKLIST_KEYS.every((k) => checklist[k] === true))
    throw new ApiError(
      "INVALID_REQUEST",
      "Complete every review acknowledgement.",
    );
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
    profileRevision: parseRevision(input.profileRevision),
    checklist: checklist as PlaylistReviewChecklist,
  };
}
