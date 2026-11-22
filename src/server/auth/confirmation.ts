import "server-only";
import { ApiError } from "@/server/http";
import { safeReturnTo } from "./redirects";
import { verifyEmailToken } from "./service";

export type ConfirmationRequest = {
  type: "signup" | "recovery";
  tokenHash: string;
  returnTo: string;
};

export function parseConfirmationRequest(
  input: Pick<URLSearchParams, "getAll"> | Pick<FormData, "getAll">,
  destinationField: "next" | "returnTo" = "next",
): ConfirmationRequest {
  const types = input.getAll("type"),
    tokens = input.getAll("token_hash"),
    destinations = input.getAll(destinationField);
  if (
    types.length !== 1 ||
    tokens.length !== 1 ||
    destinations.length > 1 ||
    (types[0] !== "signup" && types[0] !== "recovery") ||
    typeof tokens[0] !== "string" ||
    !/^[a-zA-Z0-9_-]{20,512}$/.test(tokens[0]) ||
    (destinations.length &&
      (typeof destinations[0] !== "string" || destinations[0].length > 512))
  )
    throw new ApiError(
      "INVALID_REQUEST",
      "This email link is invalid or expired. Request a new link.",
    );
  return {
    type: types[0],
    tokenHash: tokens[0],
    returnTo:
      types[0] === "recovery"
        ? "/reset-password"
        : safeReturnTo(destinations[0]),
  };
}

export async function confirmEmail(
  input: ConfirmationRequest,
): Promise<string> {
  await verifyEmailToken(input.tokenHash, input.type);
  return input.type === "recovery"
    ? "/reset-password"
    : safeReturnTo(input.returnTo);
}
