import "server-only";
import { requireUploadsEnabled } from "@/server/deployment/capabilities";
import { requireCreator } from "@/server/auth/guards";
import { ApiError } from "@/server/http";
import * as repository from "./repository";
import * as validation from "./validation";
import {
  toCreatorSnapshot,
  toCreatorList,
  toCreatorMutation,
  toCreatorReviewPreview,
} from "./projections";
import type {
  CreatorMutationResponse,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";

function assertIdentity(snapshot: CreatorScenarioSnapshot, id: string) {
  if (snapshot.id !== id)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Creator content could not be loaded safely.",
    );
  return snapshot;
}
function mutation(value: unknown, id: string): CreatorMutationResponse {
  const result = toCreatorMutation(value);
  assertIdentity(result.scenario, id);
  return result;
}
export async function listOwnedScenarios(
  cursor?: string | null,
  status?: string | null,
) {
  await requireCreator();
  const filter = validation.parseCreatorFilter(status);
  return toCreatorList(
    await repository.listOwnedScenarios(
      filter,
      validation.parseCreatorCursor(cursor, filter),
    ),
  );
}
export async function findOwnedScenario(rawId: string) {
  await requireCreator();
  const id = validation.parseCreatorId(rawId);
  const data = await repository.findOwnedScenario(id);
  if (data === null)
    throw new ApiError(
      "SCENARIO_NOT_FOUND",
      "This scenario could not be found.",
    );
  return assertIdentity(toCreatorSnapshot(data), id);
}
export async function createDraft(input: unknown) {
  await requireCreator();
  const command = validation.parseCreateDraft(input);
  return toCreatorMutation(await repository.createDraft(command.requestId));
}
export async function saveDraft(rawId: string, input: unknown) {
  await requireCreator();
  const id = validation.parseCreatorId(rawId),
    command = validation.parseSaveDraft(input);
  if (command.content.source.kind === "uploaded") await requireUploadsEnabled();
  return mutation(await repository.saveDraft(id, command), id);
}
export async function getReviewPreview(rawId: string, rawRevision: unknown) {
  await requireCreator();
  const id = validation.parseCreatorId(rawId),
    revision = validation.parseReviewRevision(rawRevision);
  const result = toCreatorReviewPreview(
    await repository.getReviewPreview(id, revision),
  );
  if (result.scenario.draft.content.source.kind === "uploaded")
    await requireUploadsEnabled();
  assertIdentity(result.scenario, id);
  if (result.scenario.revision !== revision)
    throw new ApiError(
      "SCENARIO_CONFLICT",
      "This scenario has changed. Reload the saved draft.",
    );
  return result;
}
export async function recordReview(rawId: string, input: unknown) {
  await requireCreator();
  const id = validation.parseCreatorId(rawId),
    command = validation.parseReviewCommand(input);
  return mutation(await repository.recordReview(id, command), id);
}
export async function publishScenario(rawId: string, input: unknown) {
  await requireCreator();
  const id = validation.parseCreatorId(rawId),
    command = validation.parsePublishCommand(input);
  return mutation(await repository.publishScenario(id, command), id);
}
export async function unpublishScenario(rawId: string, input: unknown) {
  await requireCreator();
  const id = validation.parseCreatorId(rawId),
    command = validation.parseUnpublishCommand(input);
  return mutation(await repository.unpublishScenario(id, command), id);
}
