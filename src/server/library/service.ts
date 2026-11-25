import "server-only";
import { ApiError } from "@/server/http";
import { parseLibraryFilters, parseLibraryScenarioId } from "./validation";
import { toLibraryList, toLibraryPreview } from "./projections";
import * as repository from "./repository";
export async function getLibrary(
  filters: { playerId?: unknown; cursor?: unknown } = {},
) {
  return toLibraryList(
    await repository.listPublishedScenarios(parseLibraryFilters(filters)),
  );
}
export async function getLibraryScenario(rawId: string) {
  const id = parseLibraryScenarioId(rawId),
    data = await repository.findPublishedScenario(id);
  if (data === null)
    throw new ApiError(
      "SCENARIO_UNAVAILABLE",
      "This scenario is not available.",
    );
  const result = toLibraryPreview(data);
  if (result.id !== id)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The scenario could not be loaded safely.",
    );
  return result;
}
