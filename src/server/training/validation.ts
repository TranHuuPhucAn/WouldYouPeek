import "server-only";
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
  const hasTarget = Boolean(
    value && typeof value === "object" && Object.hasOwn(value, "target"),
  );
  const input = object(
    value,
    hasTarget ? ["requestId", "target"] : ["requestId"],
  );
  return {
    requestId: parseUuid(input.requestId),
    ...(hasTarget ? { target: parseSessionTarget(input.target) } : {}),
  };
}
export function parseSessionTarget(value: unknown): SessionTarget {
  if (
    value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "demo"
  ) {
    object(value, ["kind"]);
    return { kind: "demo" };
  }
  const target = object(value, ["kind", "scenarioId"]);
  if (target.kind !== "scenario")
    throw new ApiError("INVALID_REQUEST", "Choose a supported session target.");
  return {
    kind: "scenario",
    scenarioId: parseUuid(target.scenarioId).toLowerCase(),
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
