import "server-only";
import type { SaveCreatorProfileRequest } from "@/contracts/creator-profile";
import {
  normalizeCreatorDisplayName,
  validateCreatorDisplayName,
} from "@/lib/playlists/content";
import { commandObject, parseRevision } from "@/server/creator/validation";
import { parseUuid } from "@/server/training/validation";
import { ApiError } from "@/server/http";
export function parseSaveCreatorProfile(
  value: unknown,
): SaveCreatorProfileRequest {
  const input = commandObject(value, [
    "requestId",
    "expectedRevision",
    "displayName",
  ]);
  const issues = validateCreatorDisplayName(input.displayName);
  if (issues.length)
    throw new ApiError(
      "INVALID_REQUEST",
      "Choose a public creator name of 2–50 characters.",
      { issues },
    );
  return {
    requestId: parseUuid(input.requestId),
    expectedRevision: parseRevision(input.expectedRevision),
    displayName: normalizeCreatorDisplayName(input.displayName as string),
  };
}
