import { NextResponse } from "next/server";
import { parseConfirmationRequest } from "@/server/auth/confirmation";
import { safeReturnTo } from "@/server/auth/redirects";
import { getServerAppConfig } from "@/server/config";

/** Opening/scanning an email link is read-only. Only the explicit form POST verifies it. */
export async function GET(request: Request) {
  const origin = getServerAppConfig().appOrigin;
  const query = new URL(request.url).searchParams;
  const fallback = safeReturnTo(
    query.getAll("next").length === 1 ? query.get("next") : null,
  );
  let destination = new URL(
    `/auth/error?returnTo=${encodeURIComponent(fallback)}`,
    origin,
  );
  try {
    const parsed = parseConfirmationRequest(query);
    destination = new URL("/auth/confirm-email", origin);
    destination.searchParams.set("type", parsed.type);
    destination.searchParams.set("token_hash", parsed.tokenHash);
    destination.searchParams.set("next", parsed.returnTo);
  } catch {
    /* Never put malformed tokens or provider details into recovery links. */
  }
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const HEAD = GET;
