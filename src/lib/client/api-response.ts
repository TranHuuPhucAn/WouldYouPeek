export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
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
    typeof failure.message === "string"
  ) {
    return new ApiClientError(failure.code, failure.message, status);
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
