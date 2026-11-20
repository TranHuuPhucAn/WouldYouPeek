import "server-only";
import type {
  CreatorProfile,
  CreatorProfileMutationResponse,
} from "@/contracts/creator-profile";
import {
  normalizeCreatorDisplayName,
  validateCreatorDisplayName,
} from "@/lib/playlists/content";
import { ApiError } from "@/server/http";
function invalid(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Your creator name could not be loaded safely.",
  );
}
export function toCreatorProfile(value: unknown): CreatorProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0) invalid();
  if (v.displayName === null) {
    if (v.revision !== 0) invalid();
    return { displayName: null, revision: 0 };
  }
  if (
    typeof v.displayName !== "string" ||
    validateCreatorDisplayName(v.displayName).length ||
    normalizeCreatorDisplayName(v.displayName) !== v.displayName ||
    Number(v.revision) < 1
  )
    invalid();
  return { displayName: v.displayName, revision: Number(v.revision) };
}
export function toCreatorProfileMutation(
  value: unknown,
): CreatorProfileMutationResponse {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("profile" in value) ||
    !("replayed" in value) ||
    typeof value.replayed !== "boolean"
  )
    invalid();
  return { profile: toCreatorProfile(value.profile), replayed: value.replayed };
}
