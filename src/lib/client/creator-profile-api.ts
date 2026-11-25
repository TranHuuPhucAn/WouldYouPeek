import type {
  CreatorProfile,
  SaveCreatorProfileRequest,
  CreatorProfileMutationResponse,
} from "@/contracts/creator-profile";
import {
  normalizeCreatorDisplayName,
  validateCreatorDisplayName,
} from "@/lib/playlists/content";
import { invalidResponse, isRecord } from "./challenge-validation";
import { playlistRequest } from "./playlist-api";
export function parseCreatorProfile(value: unknown): CreatorProfile {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !(
      value.displayName === null ||
      (typeof value.displayName === "string" &&
        validateCreatorDisplayName(value.displayName).length === 0 &&
        normalizeCreatorDisplayName(value.displayName) === value.displayName &&
        Number(value.revision) > 0)
    ) ||
    (value.displayName === null && value.revision !== 0)
  )
    invalidResponse();
  return {
    displayName: value.displayName as string | null,
    revision: Number(value.revision),
  };
}
export async function getCreatorProfile(signal?: AbortSignal) {
  return parseCreatorProfile(
    await playlistRequest("/api/account/creator-profile", signal),
  );
}
export async function saveCreatorProfile(
  input: SaveCreatorProfileRequest,
  signal?: AbortSignal,
): Promise<CreatorProfileMutationResponse> {
  const value = await playlistRequest(
    "/api/account/creator-profile",
    signal,
    "PUT",
    input,
  );
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.replayed !== "boolean"
  )
    invalidResponse();
  return {
    profile: parseCreatorProfile(value.profile),
    replayed: value.replayed,
  };
}
