import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "@/server/config";
import type { Database } from "@/types/database";

export async function createServerSupabaseClient(responseHeaders?: Headers) {
  const cookieStore = await cookies();
  const config = getPublicSupabaseConfig();
  return createServerClient<Database>(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet, headers) {
        if (responseHeaders)
          for (const [name, value] of Object.entries(headers))
            responseHeaders.set(name, value);
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          /* Rendering cannot set cookies; the proxy refreshes them before rendering. */
        }
      },
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
