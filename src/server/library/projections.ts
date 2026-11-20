import "server-only";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import { ApiError } from "@/server/http";
import { toPlayerSummary } from "@/server/players/summary";
import { isScenarioId } from "@/lib/scenario-id";
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
    !isScenarioId(v.id) ||
    !["ai", "creator", "ai-assisted"].includes(String(v.provenance)) ||
    (v.editorialOrigin !== "curated" && v.editorialOrigin !== "creator") ||
    (v.editorialOrigin === "creator" && v.provenance === "ai") ||
    !(
      v.publishedAt === null ||
      (typeof v.publishedAt === "string" &&
        v.publishedAt.length <= 50 &&
        Number.isFinite(Date.parse(v.publishedAt)))
    )
  )
    invalid();
  return {
    ...toChallengePreview(value),
    player: toPlayerSummary(v.player),
    editorialOrigin:
      v.editorialOrigin as LibraryScenarioPreview["editorialOrigin"],
    provenance: v.provenance as LibraryScenarioPreview["provenance"],
    publishedAt: v.publishedAt as string | null,
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
