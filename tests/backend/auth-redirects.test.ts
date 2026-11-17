import { describe, it, expect, vi, afterEach } from "vitest";
import { safeReturnTo, buildAuthRedirect } from "@/server/auth/redirects";
import { getPublicSupabaseConfig, getServerAppConfig } from "@/server/config";
afterEach(() => vi.unstubAllEnvs());
describe("trusted auth destinations and configuration", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil",
    "/%2f%2fevil",
    "/play?next=https://evil",
    "/play#x",
    "/auth/confirm",
    "/unknown",
    null,
  ])("rejects redirect %j", (value) =>
    expect(safeReturnTo(value)).toBe("/play"),
  );
  it.each([
    "/play",
    "/account",
    "/creator",
    "/history",
    "/demo",
    "/play/11111111-1111-4111-8111-111111111111",
  ])("keeps %s", (value) => expect(safeReturnTo(value)).toBe(value));
  it("builds callback from configured origin only", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    expect(buildAuthRedirect("recovery")).toBe(
      "http://127.0.0.1:3000/auth/confirm?next=%2Freset-password",
    );
    expect(buildAuthRedirect("signup", "//evil")).toContain("next=%2Fplay");
  });
  it("rejects missing, malformed and secret configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(getPublicSupabaseConfig).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_bad");
    expect(getPublicSupabaseConfig).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "javascript:alert(1)");
    expect(getServerAppConfig).toThrow();
  });
});
