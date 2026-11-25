import "server-only";
import { randomUUID } from "node:crypto";

export function createRequestId() {
  return randomUUID();
}

const operations = new Set(["api-error", "health"]);
const codes = new Set([
  "INTERNAL_ERROR",
  "STORAGE_UNAVAILABLE",
  "MEDIA_UNAVAILABLE",
]);

/** Deliberately accepts no request, exception, user or payload object. */
export function logOperationalEvent(event: {
  operation: "api-error" | "health";
  code: string;
  status: number;
  requestId: string;
  durationMs?: number;
}) {
  if (
    !operations.has(event.operation) ||
    !codes.has(event.code) ||
    ![500, 503].includes(event.status) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      event.requestId,
    )
  )
    return;
  const safe = {
    operation: event.operation,
    code: event.code,
    status: event.status,
    requestId: event.requestId,
    ...(typeof event.durationMs === "number" &&
    Number.isFinite(event.durationMs) &&
    event.durationMs >= 0 &&
    event.durationMs <= 3_600_000
      ? { durationMs: Math.round(event.durationMs) }
      : {}),
  };
  console.error(JSON.stringify(safe));
}
