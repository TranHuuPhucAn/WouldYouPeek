import "server-only";
import { requireVerifiedUser } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
import { parseLibraryCursor, parseLibraryScenarioId } from "./validation";
import { toLibraryList, toLibraryPreview } from "./projections";
import * as repository from "./repository";
export async function getLibrary(cursor?: string | null) {
  await requireVerifiedUser();
  return toLibraryList(
    await repository.listPublishedScenarios(parseLibraryCursor(cursor)),
  );
}
export async function getLibraryScenario(rawId: string) {
  await requireVerifiedUser();
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
