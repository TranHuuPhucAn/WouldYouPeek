import "server-only";
import { isScenarioId, normalizeScenarioId } from "@/lib/scenario-id";
import { ApiError } from "@/server/http";
import type {
  StartSessionRequest,
  AnswerSessionRequest,
  AdvanceSessionRequest,
  SessionTarget,
} from "@/contracts/session";
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value))
    throw new ApiError(
      "INVALID_REQUEST",
      "A valid record identifier is required.",
    );
  return value;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => key in value)
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "Send only the requested command fields.",
    );
  return value as Record<string, unknown>;
}
function revision(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 2_147_483_647
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "A valid saved session revision is required.",
    );
  return value;
}
export function parseStartSession(value: unknown): StartSessionRequest {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (!Object.hasOwn(raw, "target")) {
    const input = object(value, ["requestId"]);
    return { requestId: parseUuid(input.requestId) };
  }
  const target = parseSessionTarget(raw.target);
  const input = object(
    value,
    target.kind === "playlist"
      ? ["requestId", "target", "expectedPublicationVersion"]
      : ["requestId", "target"],
  );
  const requestId = parseUuid(input.requestId);
  if (target.kind === "playlist")
    return {
      requestId,
      target,
      expectedPublicationVersion: parseUuid(
        input.expectedPublicationVersion,
      ).toLowerCase(),
    };
  return { requestId, target };
}
export function parseSessionTarget(value: unknown): SessionTarget {
  if (value && typeof value === "object" && "kind" in value) {
    if (value.kind === "demo") {
      object(value, ["kind"]);
      return { kind: "demo" };
    }
    if (value.kind === "playlist") {
      const target = object(value, ["kind", "playlistId"]);
      return {
        kind: "playlist",
        playlistId: parseUuid(target.playlistId).toLowerCase(),
      };
    }
  }
  const target = object(value, ["kind", "scenarioId"]);
  if (target.kind !== "scenario" || !isScenarioId(target.scenarioId))
    throw new ApiError("INVALID_REQUEST", "Choose a valid session target.");
  return {
    kind: "scenario",
    scenarioId: normalizeScenarioId(target.scenarioId),
  };
}
export function parseAnswerCommand(value: unknown): AnswerSessionRequest {
  const input = object(value, ["optionId", "requestId", "expectedRevision"]);
  if (
    typeof input.optionId !== "string" ||
    !/^[a-z0-9-]{1,100}$/i.test(input.optionId)
  )
    throw new ApiError("INVALID_REQUEST", "Choose a valid option.");
  return {
    optionId: input.optionId,
    requestId: parseUuid(input.requestId),
    expectedRevision: revision(input.expectedRevision),
  };
}
export function parseAdvanceCommand(value: unknown): AdvanceSessionRequest {
  const input = object(value, ["fromItemId", "requestId", "expectedRevision"]);
  return {
    fromItemId: parseUuid(input.fromItemId),
    requestId: parseUuid(input.requestId),
    expectedRevision: revision(input.expectedRevision),
  };
}
export function parseHistoryCursor(value?: unknown): string | null {
  return value === undefined || value === null ? null : parseUuid(value);
}
