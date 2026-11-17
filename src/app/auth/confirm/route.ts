import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/server/auth/service";
import { safeReturnTo } from "@/server/auth/redirects";
import { getServerAppConfig } from "@/server/config";

export async function GET(request: Request) {
  const origin = getServerAppConfig().appOrigin;
  const query = new URL(request.url).searchParams;
  const type = query.get("type");
  const tokenHash = query.get("token_hash");
  let destination = "/auth/error";
  let providerHeaders: Headers | undefined;
  if ((type === "signup" || type === "recovery") && tokenHash) {
    try {
      providerHeaders = await verifyEmailToken(tokenHash, type);
      destination =
        type === "recovery"
          ? "/reset-password"
          : safeReturnTo(query.get("next"));
    } catch {
      /* Never include one-time tokens or provider errors in the destination. */
    }
  }
  const response = NextResponse.redirect(new URL(destination, origin), 303);
  if (providerHeaders)
    for (const [name, value] of providerHeaders)
      response.headers.set(name, value);
  if (!response.headers.has("Cache-Control"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}
