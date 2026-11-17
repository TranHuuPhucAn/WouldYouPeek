import "server-only";
import type { ApiErrorCode, ApiErrorResponse } from "@/contracts/challenge";

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  INVALID_OPTION: 400,
  CHALLENGE_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  AUTH_REQUIRED: 401,
  EMAIL_NOT_VERIFIED: 403,
  CREATOR_REQUIRED: 403,
  SESSION_NOT_FOUND: 404,
  SESSION_CONFLICT: 409,
  ANSWER_LOCKED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SESSION_REQUIRED: 409,
  RATE_LIMITED: 429,
  STORAGE_UNAVAILABLE: 503,
};
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("INVALID_JSON", "Send a valid JSON request.");
  }
}
export function requireSameOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  let origin: string;
  try {
    if (!configured) throw new Error();
    origin = new URL(configured).origin;
  } catch {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Configure the application URL before using accounts.",
    );
  }
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "This request must come from this application.",
    );
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError("INVALID_REQUEST", "Send an application/json request.");
}
export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function errorResponse(error: unknown): Response {
  const known = error instanceof ApiError && error.code !== "INTERNAL_ERROR";
  const code = known ? error.code : "INTERNAL_ERROR";
  const body: ApiErrorResponse = {
    error: {
      code,
      message: known
        ? error.message
        : "Something went wrong. Please try again.",
    },
  };
  const response = jsonResponse(body, ERROR_STATUS[code]);
  if (code === "RATE_LIMITED") response.headers.set("Retry-After", "60");
  return response;
}
export async function handleRoute(
  operation: () => unknown | Promise<unknown>,
): Promise<Response> {
  try {
    return jsonResponse(await operation());
  } catch (error) {
    return errorResponse(error);
  }
}
export function databaseError(error: {
  message?: string;
  code?: string;
}): never {
  const messages: Partial<Record<ApiErrorCode, string>> = {
    AUTH_REQUIRED: "Sign in to continue.",
    EMAIL_NOT_VERIFIED: "Verify your email before continuing.",
    CREATOR_REQUIRED: "Enable creator access first.",
    SESSION_NOT_FOUND: "This session could not be found.",
    SESSION_CONFLICT: "Your saved session has changed. Reload it to continue.",
    ANSWER_LOCKED: "This answer has already been saved.",
    IDEMPOTENCY_CONFLICT:
      "This request identifier was already used for another action.",
    INVALID_OPTION: "Choose one of this scenario's options.",
    INVALID_REQUEST: "The request is invalid.",
    CHALLENGE_NOT_FOUND: "This challenge could not be found.",
  };
  const code = error.message as ApiErrorCode;
  if (Object.hasOwn(messages, code)) throw new ApiError(code, messages[code]!);
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Saved training is temporarily unavailable. Please try again.",
  );
}
