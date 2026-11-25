import "server-only";
import type { PlayerSummary } from "@/contracts/player";
import { UUID_PATTERN } from "@/server/training/validation";
import { ApiError } from "@/server/http";
import { normalizePlayerDisplayName } from "@/lib/players/identity";
export function toPlayerSummary(value: unknown): PlayerSummary {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const v = value as Record<string, unknown>;
    if (
      typeof v.id !== "string" ||
      !UUID_PATTERN.test(v.id) ||
      typeof v.displayName !== "string" ||
      normalizePlayerDisplayName(v.displayName) !== v.displayName
    )
      throw new Error();
    return { id: v.id, displayName: v.displayName };
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The player catalogue could not be loaded safely.",
    );
  }
}
