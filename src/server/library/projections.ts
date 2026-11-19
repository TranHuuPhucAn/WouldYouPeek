import "server-only";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import { ApiError } from "@/server/http";
import { toChallengePreview } from "@/server/training/projections";
function invalid(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "The scenario library could not be loaded safely.",
  );
}
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) invalid();
  return v as Record<string, unknown>;
}
export function toLibraryPreview(value: unknown): LibraryScenarioPreview {
  const v = record(value);
  if (
    (v.provenance !== "creator" && v.provenance !== "ai-assisted") ||
    typeof v.publishedAt !== "string" ||
    v.publishedAt.length > 50 ||
    !Number.isFinite(Date.parse(v.publishedAt))
  )
    invalid();
  return {
    ...toChallengePreview(value),
    provenance: v.provenance,
    publishedAt: v.publishedAt,
  };
}
export function toLibraryList(value: unknown): LibraryListResponse {
  const v = record(value);
  if (
    !Array.isArray(v.scenarios) ||
    v.scenarios.length > 50 ||
    (v.nextCursor !== null &&
      (typeof v.nextCursor !== "string" || v.nextCursor.length > 1024))
  )
    invalid();
  const scenarios = v.scenarios.map(toLibraryPreview);
  if (new Set(scenarios.map((s) => s.id)).size !== scenarios.length) invalid();
  return { scenarios, nextCursor: v.nextCursor as string | null };
}
