import "server-only";
import type { ApiErrorCode, ApiErrorResponse } from "@/contracts/challenge";

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_JSON: 400,
  INVALID_REQUEST: 400,
  INVALID_OPTION: 400,
  CHALLENGE_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
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
    throw new ApiError("INVALID_JSON", "Send a valid JSON answer.");
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
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
  return jsonResponse(body, ERROR_STATUS[code]);
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
