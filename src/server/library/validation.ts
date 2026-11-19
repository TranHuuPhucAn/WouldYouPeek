import "server-only";
import { parseCreatorId, parseCursor } from "@/server/creator/validation";
export function parseLibraryCursor(value?: unknown) {
  return parseCursor(value, "library");
}
export function parseLibraryScenarioId(value: unknown) {
  return parseCreatorId(value);
}
