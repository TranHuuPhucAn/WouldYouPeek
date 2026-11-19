import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/server/config";
import type { Database } from "@/types/database";

export async function refreshAuthSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  let config: ReturnType<typeof getPublicSupabaseConfig>;
  try {
    config = getPublicSupabaseConfig();
  } catch {
    return response;
  }
  const client = createServerClient<Database>(
    config.url,
    config.publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet)
            request.cookies.set(name, value);
          const updated = NextResponse.next({ request });
          for (const cookie of response.cookies.getAll())
            updated.cookies.set(cookie);
          for (const [name, value] of response.headers)
            if (name !== "set-cookie" && !name.startsWith("x-middleware-"))
              updated.headers.set(name, value);
          for (const { name, value, options } of cookiesToSet)
            updated.cookies.set(name, value, options);
          if (headers)
            for (const [name, value] of Object.entries(headers))
              updated.headers.set(name, value);
          response = updated;
        },
      },
    },
  );
  const { data } = await client.auth.getClaims();
  const protectedPath = /^\/(?:play|history|account|creator)(?:\/|$)/.test(
    request.nextUrl.pathname,
  );
  if (!data?.claims.sub && protectedPath) {
    const destination = request.nextUrl.clone();
    destination.pathname = "/sign-in";
    destination.search = "";
    destination.searchParams.set("returnTo", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(destination);
    for (const cookie of response.cookies.getAll())
      redirect.cookies.set(cookie);
    for (const [name, value] of response.headers)
      if (
        ![
          "location",
          "x-middleware-next",
          "x-middleware-override-headers",
        ].includes(name) &&
        !name.startsWith("x-middleware-request-") &&
        name !== "set-cookie"
      )
        redirect.headers.set(name, value);
    if (!redirect.headers.has("Cache-Control"))
      redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  if (!response.headers.has("Cache-Control"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}
