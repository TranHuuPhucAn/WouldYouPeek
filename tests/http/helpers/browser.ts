import { createServerClient } from "@supabase/ssr";
import { expect } from "vitest";
import {
  assertLocalTestTarget,
  getLocalTestConfig,
} from "../../integration/helpers/local-supabase";
import type { TestUser } from "../../integration/helpers/test-users";

export function appOrigin() {
  getLocalTestConfig();
  return assertLocalTestTarget(process.env.SUPABASE_TEST_APP_URL ?? "", "3100")
    .origin;
}

/** Use the supported SSR cookie adapter instead of forging provider cookies. */
export async function loginBrowser(user: TestUser) {
  const config = getLocalTestConfig(),
    jar = new Map<string, string>();
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const result = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (result.error)
    throw new Error("Could not establish disposable SSR test cookies.");
  expect(jar.size).toBeGreaterThan(0);
  return { client, jar };
}
export type Browser = Awaited<ReturnType<typeof loginBrowser>>;

export async function api<T = unknown>(
  browser: Browser | null,
  path: string,
  body?: unknown,
  options: {
    method?: string;
    headers?: Record<string, string>;
    rawBody?: string;
  } = {},
) {
  const origin = appOrigin(),
    headers = new Headers(options.headers);
  if (browser)
    headers.set(
      "Cookie",
      [...browser.jar].map(([name, value]) => `${name}=${value}`).join("; "),
    );
  const encoded =
    options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  if (encoded !== undefined) {
    if (!headers.has("Origin")) headers.set("Origin", origin);
    if (!headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? (encoded === undefined ? "GET" : "POST"),
    headers,
    body: encoded,
    redirect: "manual",
  });
  if (browser)
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0],
        split = pair.indexOf("=");
      const name = pair.slice(0, split),
        value = pair.slice(split + 1);
      if (value && !/max-age=0(?:;|$)/i.test(header))
        browser.jar.set(name, value);
      else browser.jar.delete(name);
    }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `Expected JSON from ${path}, received HTTP ${response.status}.`,
    );
  }
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  return { response, data: data as T };
}
