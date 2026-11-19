import type {
  CreatorCommand,
  CreatorFilter,
  CreateDraftRequest,
  PublishDraftRequest,
  ReviewDraftRequest,
  SaveDraftRequest,
} from "@/contracts/creator";
import { ApiClientError, readApiResponse } from "./api-response";
import {
  parseCreatorList,
  parseCreatorMutationResponse,
  parseCreatorReview,
  parseCreatorSnapshot,
} from "./creator-validation";
import { isUuid } from "./session-api";
function path(id: string) {
  if (!isUuid(id))
    throw new ApiClientError(
      "INVALID_REQUEST",
      "This scenario is unavailable.",
      400,
    );
  return `/api/creator/scenarios/${encodeURIComponent(id)}`;
}
async function request(
  url: string,
  signal?: AbortSignal,
  method = "GET",
  body?: unknown,
) {
  return readApiResponse(
    await fetch(url, {
      method,
      signal,
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}
export async function listCreatorScenarios(
  cursor: string | null = null,
  status: CreatorFilter = "all",
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ status });
  if (cursor) query.set("cursor", cursor);
  return parseCreatorList(
    await request(`/api/creator/scenarios?${query}`, signal),
  );
}
export async function getCreatorScenario(id: string, signal?: AbortSignal) {
  return parseCreatorSnapshot(await request(path(id), signal), id);
}
export async function createCreatorScenario(
  input: CreateDraftRequest,
  signal?: AbortSignal,
) {
  return parseCreatorMutationResponse(
    await request("/api/creator/scenarios", signal, "POST", input),
  );
}
export async function saveCreatorScenario(
  id: string,
  input: SaveDraftRequest,
  signal?: AbortSignal,
) {
  return parseCreatorMutationResponse(
    await request(path(id), signal, "PUT", input),
    id,
  );
}
export async function getCreatorReview(
  id: string,
  revision: number,
  signal?: AbortSignal,
) {
  return parseCreatorReview(
    await request(`${path(id)}/review?revision=${revision}`, signal),
    id,
    revision,
  );
}
export async function reviewCreatorScenario(
  id: string,
  input: ReviewDraftRequest,
  signal?: AbortSignal,
) {
  return parseCreatorMutationResponse(
    await request(`${path(id)}/review`, signal, "POST", input),
    id,
  );
}
export async function publishCreatorScenario(
  id: string,
  input: PublishDraftRequest,
  signal?: AbortSignal,
) {
  return parseCreatorMutationResponse(
    await request(`${path(id)}/publish`, signal, "POST", input),
    id,
  );
}
export async function unpublishCreatorScenario(
  id: string,
  input: CreatorCommand,
  signal?: AbortSignal,
) {
  return parseCreatorMutationResponse(
    await request(`${path(id)}/unpublish`, signal, "POST", input),
    id,
  );
}
