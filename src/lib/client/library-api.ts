import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import { readApiResponse } from "./api-response";
import {
  invalidResponse,
  isRecord,
  parseChallengePreview,
} from "./challenge-validation";
import { isDate, isUuid } from "./session-api";
export function parseLibraryEntry(
  value: unknown,
  expectedId?: string,
): LibraryScenarioPreview {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (expectedId && value.id !== expectedId) ||
    !["creator", "ai-assisted"].includes(String(value.provenance)) ||
    !isDate(value.publishedAt)
  )
    invalidResponse();
  const { provenance, publishedAt, ...preview } = value;
  return {
    ...parseChallengePreview(preview),
    provenance: provenance as LibraryScenarioPreview["provenance"],
    publishedAt,
  };
}
export function parseLibraryPage(value: unknown): LibraryListResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["scenarios", "nextCursor"].includes(key),
    ) ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length > 50 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        value.nextCursor.length > 0 &&
        value.nextCursor.length <= 1024)
    )
  )
    invalidResponse();
  const scenarios = value.scenarios.map((item) => parseLibraryEntry(item));
  if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length)
    invalidResponse();
  return { scenarios, nextCursor: value.nextCursor };
}
export async function listLibraryScenarios(
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  return parseLibraryPage(
    await readApiResponse(
      await fetch(
        `/api/library/scenarios${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { cache: "no-store", signal },
      ),
    ),
  );
}
export async function getLibraryScenario(id: string, signal?: AbortSignal) {
  return parseLibraryEntry(
    await readApiResponse(
      await fetch(`/api/library/scenarios/${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal,
      }),
    ),
    id,
  );
}
