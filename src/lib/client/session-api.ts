import type {
  AdvanceSessionRequest,
  AnswerSessionRequest,
  CreateSessionResponse,
  SessionHistoryResponse,
  SessionMutationResponse,
  SessionSnapshot,
  SessionSummary,
  StartSessionRequest,
  SessionTarget,
} from "@/contracts/session";
import { ApiClientError, readApiResponse } from "./api-response";
import { parsePlaylistSessionMetadata } from "./playlist-validation";
import { isScenarioId } from "@/lib/scenario-id";
import {
  invalidResponse,
  isRecord,
  parseAnswerResponse,
  parseChallengeDetail,
  validateAnswerForChallenge,
} from "./challenge-validation";

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT/.test(value) &&
  Number.isFinite(Date.parse(value));
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function parseSessionTarget(value: unknown): SessionTarget {
  if (!isRecord(value)) invalidResponse();
  if (value.kind === "demo" && Object.keys(value).length === 1)
    return { kind: "demo" };
  if (
    value.kind === "scenario" &&
    isScenarioId(value.scenarioId) &&
    Object.keys(value).length === 2
  )
    return { kind: "scenario", scenarioId: value.scenarioId };
  if (
    value.kind === "playlist" &&
    isUuid(value.playlistId) &&
    Object.keys(value).length === 2
  )
    return { kind: "playlist", playlistId: value.playlistId };
  return invalidResponse();
}
function requireTitle(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 300)
    invalidResponse();
}
export function parseSessionSnapshot(
  value: unknown,
  expectedId?: string,
): SessionSnapshot {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (expectedId && value.id !== expectedId) ||
    !isCount(value.revision) ||
    !isDate(value.createdAt) ||
    !isDate(value.updatedAt) ||
    !Array.isArray(value.items) ||
    !value.items.length
  )
    invalidResponse();
  const body = value as SessionSnapshot;
  parseSessionTarget(body.target);
  requireTitle(body.title);
  if (body.target.kind === "playlist") {
    body.playlist = parsePlaylistSessionMetadata(body.playlist);
    if (
      body.items.length > 20 ||
      body.playlist.players.length > body.items.length
    )
      invalidResponse();
  } else if (body.playlist !== undefined) invalidResponse();
  if (
    body.target.kind === "scenario" &&
    (body.items.length !== 1 ||
      body.items[0].challenge.id !== body.target.scenarioId)
  )
    invalidResponse();
  if (body.status === "completed") {
    if (
      body.phase !== "completed" ||
      body.currentIndex !== null ||
      !isDate(body.completedAt)
    )
      invalidResponse();
  } else if (
    body.status !== "in_progress" ||
    !["setup", "review"].includes(body.phase) ||
    !isCount(body.currentIndex) ||
    body.currentIndex >= body.items.length ||
    body.completedAt !== null
  )
    invalidResponse();
  const ids = new Set<string>();
  const answerIds = new Set<string>();
  const challengeIds = new Set<string>();
  body.items.forEach((item, index) => {
    if (
      !isRecord(item) ||
      !isUuid(item.id) ||
      item.position !== index ||
      ids.has(item.id)
    )
      invalidResponse();
    ids.add(item.id);
    const challenge = parseChallengeDetail(item.challenge);
    if (challengeIds.has(challenge.id)) invalidResponse();
    challengeIds.add(challenge.id);
    const needsAnswer =
      body.status === "completed" ||
      index < body.currentIndex! ||
      (index === body.currentIndex && body.phase === "review");
    if (!needsAnswer) {
      if (item.answer !== null) invalidResponse();
      return;
    }
    if (
      !isRecord(item.answer) ||
      !isUuid(item.answer.id) ||
      answerIds.has(item.answer.id) ||
      !isDate(item.answer.answeredAt)
    )
      invalidResponse();
    answerIds.add(item.answer.id);
    validateAnswerForChallenge(
      parseAnswerResponse(item.answer.result),
      challenge,
    );
  });
  const answered = body.items.filter((item) => item.answer).length;
  const expectedRevision =
    body.status === "completed"
      ? body.items.length * 2
      : body.currentIndex! * 2 + (body.phase === "review" ? 1 : 0);
  if (
    body.revision !== expectedRevision ||
    answered > body.items.length ||
    Date.parse(body.updatedAt) < Date.parse(body.createdAt)
  )
    invalidResponse();
  return body;
}

/** A saved run keeps its original scenario versions across every command. */
export function validateSessionContinuity(
  next: SessionSnapshot,
  previous: SessionSnapshot,
): void {
  if (
    next.id !== previous.id ||
    next.title !== previous.title ||
    JSON.stringify(next.playlist) !== JSON.stringify(previous.playlist) ||
    JSON.stringify(next.target) !== JSON.stringify(previous.target) ||
    next.items.length !== previous.items.length ||
    next.items.some((item, index) => {
      const before = previous.items[index];
      return (
        item.id !== before.id ||
        item.position !== before.position ||
        item.challenge.id !== before.challenge.id ||
        item.challenge.contentVersion !== before.challenge.contentVersion ||
        (before.answer !== null &&
          (!item.answer ||
            item.answer.id !== before.answer.id ||
            item.answer.result.selectedOptionId !==
              before.answer.result.selectedOptionId))
      );
    })
  )
    invalidResponse();
}

export function parseSessionSummary(value: unknown): SessionSummary {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !["in_progress", "completed"].includes(String(value.status)) ||
    !isCount(value.answeredCount) ||
    !isCount(value.totalCount) ||
    value.totalCount === 0 ||
    value.answeredCount > value.totalCount ||
    !isDate(value.createdAt) ||
    !isDate(value.updatedAt) ||
    (value.status === "completed"
      ? !isDate(value.completedAt) || value.answeredCount !== value.totalCount
      : value.completedAt !== null)
  )
    invalidResponse();
  parseSessionTarget(value.target);
  requireTitle(value.title);
  if ((value.target as SessionTarget).kind === "playlist") {
    const playlist = parsePlaylistSessionMetadata(value.playlist);
    value.playlist = playlist;
    if (value.totalCount > 20 || playlist.players.length > value.totalCount)
      invalidResponse();
  } else if (value.playlist !== undefined) invalidResponse();
  if (
    (value.target as SessionTarget).kind === "scenario" &&
    value.totalCount !== 1
  )
    invalidResponse();
  return value as SessionSummary;
}
export function parseSessionHistory(value: unknown): SessionHistoryResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sessions) ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" && value.nextCursor.length > 0)
    )
  )
    invalidResponse();
  const sessions = value.sessions.map(parseSessionSummary);
  if (new Set(sessions.map((item) => item.id)).size !== sessions.length)
    invalidResponse();
  return { sessions, nextCursor: value.nextCursor };
}
function mutation(value: unknown, id?: string): SessionMutationResponse {
  if (!isRecord(value) || typeof value.replayed !== "boolean")
    invalidResponse();
  return {
    session: parseSessionSnapshot(value.session, id),
    replayed: value.replayed,
  };
}
async function request(url: string, signal?: AbortSignal, body?: unknown) {
  return readApiResponse(
    await fetch(url, {
      cache: "no-store",
      signal,
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}
function requireCommand(requestId: unknown, revision?: unknown) {
  if (!isUuid(requestId) || (revision !== undefined && !isCount(revision)))
    throw new ApiClientError(
      "INVALID_REQUEST",
      "This action couldn’t be prepared. Reload and try again.",
      400,
    );
}
function requireId(id: string) {
  if (!isUuid(id))
    throw new ApiClientError(
      "INVALID_REQUEST",
      "This session isn’t available.",
      400,
    );
}

export async function createOrResumeSession(
  input: StartSessionRequest,
  signal?: AbortSignal,
): Promise<CreateSessionResponse> {
  requireCommand(input.requestId);
  if (input.target !== undefined) parseSessionTarget(input.target);
  if (
    input.target?.kind === "playlist"
      ? !isUuid(input.expectedPublicationVersion)
      : input.expectedPublicationVersion !== undefined
  )
    throw new ApiClientError(
      "INVALID_REQUEST",
      "Refresh the playlist preview before starting.",
      400,
    );
  const value = await request("/api/sessions", signal, input);
  if (!isRecord(value) || typeof value.created !== "boolean") invalidResponse();
  const result = { ...mutation(value), created: value.created };
  if (
    input.target &&
    JSON.stringify(input.target) !== JSON.stringify(result.session.target)
  )
    invalidResponse();
  if (
    input.target?.kind === "playlist" &&
    result.created &&
    result.session.playlist?.publicationVersion !==
      input.expectedPublicationVersion
  )
    invalidResponse();
  return result;
}
export async function getSession(id: string, signal?: AbortSignal) {
  requireId(id);
  return parseSessionSnapshot(
    await request(`/api/sessions/${encodeURIComponent(id)}`, signal),
    id,
  );
}
export async function listSessions(
  cursor?: string | null,
  signal?: AbortSignal,
) {
  return parseSessionHistory(
    await request(
      `/api/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal,
    ),
  );
}
export async function answerSessionItem(
  sessionId: string,
  itemId: string,
  input: AnswerSessionRequest,
  signal?: AbortSignal,
) {
  requireId(sessionId);
  requireId(itemId);
  requireCommand(input.requestId, input.expectedRevision);
  if (typeof input.optionId !== "string" || !input.optionId.trim())
    throw new ApiClientError("INVALID_REQUEST", "Choose an option first.", 400);
  const result = mutation(
    await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}/answer`,
      signal,
      input,
    ),
    sessionId,
  );
  const item = result.session.items.find((item) => item.id === itemId);
  if (!item?.answer || item.answer.result.selectedOptionId !== input.optionId)
    invalidResponse();
  return result;
}
export async function advanceSession(
  sessionId: string,
  input: AdvanceSessionRequest,
  signal?: AbortSignal,
) {
  requireId(sessionId);
  requireId(input.fromItemId);
  requireCommand(input.requestId, input.expectedRevision);
  const result = mutation(
    await request(
      `/api/sessions/${encodeURIComponent(sessionId)}/advance`,
      signal,
      input,
    ),
    sessionId,
  );
  const item = result.session.items.find(
    (item) => item.id === input.fromItemId,
  );
  if (
    !item?.answer ||
    (result.session.status !== "completed" &&
      result.session.currentIndex! <= item.position)
  )
    invalidResponse();
  return result;
}
