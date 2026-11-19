import type { ApiErrorResponse } from "@/contracts/challenge";
import type { SessionSummary } from "@/contracts/session";
import { parseSessionSummary } from "./session-api";
type SafeDetails = ApiErrorResponse["error"]["details"];
export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: SafeDetails,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function parseApiError(body: unknown, status: number): ApiClientError {
  const failure =
    body && typeof body === "object" && "error" in body ? body.error : null;
  if (
    failure &&
    typeof failure === "object" &&
    "code" in failure &&
    typeof failure.code === "string" &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.length <= 500
  ) {
    let details: SafeDetails;
    if (
      "details" in failure &&
      failure.details &&
      typeof failure.details === "object"
    ) {
      const raw = failure.details;
      if (failure.code === "ACTIVE_SESSION_EXISTS" && "activeSession" in raw) {
        try {
          const item = parseSessionSummary(raw.activeSession);
          if (item.status === "in_progress") {
            const {
              id,
              target,
              title,
              status,
              answeredCount,
              totalCount,
              createdAt,
              updatedAt,
              completedAt,
            } = item;
            details = {
              activeSession: {
                id,
                target,
                title,
                status,
                answeredCount,
                totalCount,
                createdAt,
                updatedAt,
                completedAt,
              } satisfies SessionSummary,
            };
          }
        } catch {
          /* Do not turn malformed diagnostics into a navigation target. */
        }
      } else if (
        ["DRAFT_NOT_READY", "INVALID_REQUEST"].includes(failure.code) &&
        "issues" in raw &&
        Array.isArray(raw.issues) &&
        raw.issues.length <= 100
      ) {
        const issues = raw.issues
          .filter(
            (issue) =>
              issue &&
              typeof issue === "object" &&
              typeof issue.path === "string" &&
              /^[\w.\[\]-]{0,160}$/.test(issue.path) &&
              typeof issue.code === "string" &&
              issue.code.length <= 80 &&
              typeof issue.message === "string" &&
              issue.message.length <= 500,
          )
          .map(({ path, code, message }) => ({ path, code, message }));
        if (issues.length === raw.issues.length) details = { issues };
      }
    }
    return new ApiClientError(failure.code, failure.message, status, details);
  }
  return new ApiClientError(
    "REQUEST_FAILED",
    "Something went wrong. Please try again.",
    status,
  );
}

export async function readApiResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiClientError(
      "INVALID_RESPONSE",
      "We couldn’t read the response. Please try again.",
      response.status,
    );
  }
  if (!response.ok) throw parseApiError(body, response.status);
  if (!body || typeof body !== "object")
    throw new ApiClientError(
      "INVALID_RESPONSE",
      "The response was incomplete. Please try again.",
      response.status,
    );
  return body;
}
