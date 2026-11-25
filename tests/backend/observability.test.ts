import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestId, logOperationalEvent } from "@/server/observability";
afterEach(() => vi.restoreAllMocks());
describe("bounded operational diagnostics", () => {
  it("records only allowlisted fields, never supplied raw details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const requestId = createRequestId();
    logOperationalEvent({
      operation: "api-error",
      code: "INTERNAL_ERROR",
      status: 500,
      requestId,
      durationMs: 12.2,
      ...{
        email: "private@example.com",
        token: "secret",
        message: "private report",
      },
    });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      operation: "api-error",
      code: "INTERNAL_ERROR",
      status: 500,
      requestId,
      durationMs: 12,
    });
  });
  it("rejects unrecognized event codes and request-id injection", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logOperationalEvent({
      operation: "health",
      code: "private@example.com",
      status: 503,
      requestId: createRequestId(),
    });
    logOperationalEvent({
      operation: "health",
      code: "STORAGE_UNAVAILABLE",
      status: 503,
      requestId: "fake\nsecret",
    });
    expect(log).not.toHaveBeenCalled();
  });
});
