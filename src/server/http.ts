import "server-only";
import type {
  ApiErrorCode,
  ApiErrorResponse,
  ApiErrorDetails,
} from "@/contracts/challenge";
import type { SessionSummary } from "@/contracts/session";

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
  SCENARIO_NOT_FOUND: 404,
  SCENARIO_CONFLICT: 409,
  DRAFT_NOT_READY: 422,
  REVIEW_REQUIRED: 409,
  SCENARIO_UNAVAILABLE: 404,
  ACTIVE_SESSION_EXISTS: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  STORAGE_UNAVAILABLE: 503,
  VIDEO_NOT_FOUND: 404,
  VIDEO_CONFLICT: 409,
  VIDEO_NOT_READY: 409,
  VIDEO_IN_USE: 409,
  UPLOAD_LIMIT_REACHED: 429,
  UPLOAD_EXPIRED: 410,
  VIDEO_UNSUPPORTED: 422,
  MEDIA_UNAVAILABLE: 503,
};
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function readLimitedJsonBody(
  request: Request,
  maxBytes = 65_536,
): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    /^\d+$/.test(declared) &&
    Number(declared) > maxBytes
  )
    throw new ApiError("PAYLOAD_TOO_LARGE", "This request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_JSON", "Send a valid JSON request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError("PAYLOAD_TOO_LARGE", "This request is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_JSON", "Send a valid JSON request.");
  } finally {
    reader.releaseLock();
  }
}

/** Only known detail shapes may cross the API boundary; never forward diagnostics. */
export function safeErrorDetails(
  code: ApiErrorCode,
  value: unknown,
): ApiErrorDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (
    (code === "DRAFT_NOT_READY" || code === "INVALID_REQUEST") &&
    "issues" in value &&
    Array.isArray(value.issues) &&
    value.issues.length <= 100
  ) {
    const issues = value.issues.map((v: unknown) => {
      if (
        !v ||
        typeof v !== "object" ||
        !("path" in v) ||
        !("code" in v) ||
        !("message" in v) ||
        typeof v.path !== "string" ||
        typeof v.code !== "string" ||
        typeof v.message !== "string" ||
        v.path.length > 160 ||
        v.code.length > 60 ||
        v.message.length > 300
      )
        return null;
      return { path: v.path, code: v.code, message: v.message };
    });
    if (issues.every((v) => v !== null)) return { issues };
  }
  if (code === "ACTIVE_SESSION_EXISTS" && "activeSession" in value) {
    const s = value.activeSession;
    if (!s || typeof s !== "object" || Array.isArray(s)) return;
    const v = s as Record<string, unknown>;
    const target = v.target as Record<string, unknown> | undefined;
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      typeof v.id !== "string" ||
      !uuid.test(v.id) ||
      v.status !== "in_progress" ||
      typeof v.title !== "string" ||
      v.title.length > 300 ||
      !target ||
      typeof target !== "object" ||
      (target.kind !== "demo" &&
        (target.kind !== "scenario" ||
          typeof target.scenarioId !== "string" ||
          !uuid.test(target.scenarioId)))
    )
      return;
    if (
      !Number.isSafeInteger(v.answeredCount) ||
      !Number.isSafeInteger(v.totalCount) ||
      Number(v.answeredCount) < 0 ||
      Number(v.totalCount) < 1 ||
      Number(v.answeredCount) > Number(v.totalCount) ||
      Number(v.totalCount) > 100 ||
      v.completedAt !== null
    )
      return;
    if (
      typeof v.createdAt !== "string" ||
      typeof v.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(v.createdAt)) ||
      !Number.isFinite(Date.parse(v.updatedAt))
    )
      return;
    return {
      activeSession: {
        id: v.id,
        title: v.title,
        target:
          target.kind === "demo"
            ? { kind: "demo" }
            : { kind: "scenario", scenarioId: target.scenarioId as string },
        status: "in_progress",
        answeredCount: v.answeredCount as number,
        totalCount: v.totalCount as number,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        completedAt: null,
      } satisfies SessionSummary,
    };
  }
}
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError("INVALID_JSON", "Send a valid JSON request.");
  }
}
export function readQueryParams(
  request: Request,
  allowed: string[],
): URLSearchParams {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw new ApiError(
        "INVALID_REQUEST",
        "Use only the supported query fields.",
      );
  }
  return params;
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
      ...(known && safeErrorDetails(code, error.details)
        ? { details: safeErrorDetails(code, error.details) }
        : {}),
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
  details?: string;
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
    SCENARIO_NOT_FOUND: "This scenario could not be found.",
    SCENARIO_CONFLICT:
      "This scenario has changed. Load the latest saved draft.",
    DRAFT_NOT_READY:
      "Complete the indicated fields before reviewing this scenario.",
    REVIEW_REQUIRED: "Review the current saved draft before publishing.",
    SCENARIO_UNAVAILABLE: "This scenario is not available for a new session.",
    ACTIVE_SESSION_EXISTS:
      "Finish your current session before starting a different scenario.",
    PAYLOAD_TOO_LARGE: "This request is too large.",
    VIDEO_NOT_FOUND: "This video could not be found.",
    VIDEO_CONFLICT: "This video has changed. Reload it to continue.",
    VIDEO_NOT_READY: "Wait for this video to finish validation.",
    VIDEO_IN_USE: "This video is referenced by a draft or saved publication.",
    UPLOAD_LIMIT_REACHED: "Your video upload limit has been reached.",
    UPLOAD_EXPIRED:
      "This upload has expired. Remove it and start a new upload.",
    VIDEO_UNSUPPORTED: "Use a supported MP4 recording.",
    MEDIA_UNAVAILABLE: "This video is temporarily unavailable.",
  };
  const code = error.message as ApiErrorCode;
  if (Object.hasOwn(messages, code)) {
    let details: unknown;
    if (error.details && error.details.length < 100_000) {
      try {
        details = JSON.parse(error.details);
      } catch {
        /* Provider details are not public data. */
      }
    }
    throw new ApiError(code, messages[code]!, safeErrorDetails(code, details));
  }
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Saved training is temporarily unavailable. Please try again.",
  );
}
