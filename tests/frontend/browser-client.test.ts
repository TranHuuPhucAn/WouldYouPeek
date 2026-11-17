import { afterEach, expect, it, vi } from "vitest";
const factory = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: factory }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it("requires public configuration and never creates a fake session", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  const { createBrowserSupabaseClient } =
    await import("@/lib/supabase/browser");
  expect(() => createBrowserSupabaseClient()).toThrow("not configured");
  expect(factory).not.toHaveBeenCalled();
});
it("reuses the browser client with public configuration only", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  const { createBrowserSupabaseClient } =
    await import("@/lib/supabase/browser");
  expect(createBrowserSupabaseClient()).toBe(createBrowserSupabaseClient());
  expect(factory).toHaveBeenCalledOnce();
  expect(factory).toHaveBeenCalledWith(
    "http://127.0.0.1:54321",
    "test-publishable-key",
  );
});
