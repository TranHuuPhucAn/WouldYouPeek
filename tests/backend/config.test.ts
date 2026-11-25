import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerAppConfig } from "@/server/config";
const project = "abcdefghijklmnopqrst";
function hosted() {
  Object.entries({
    WYP_DEPLOYMENT_MODE: "hosted",
    WYP_RELEASE_ENVIRONMENT: "production",
    VERCEL_ENV: "production",
    WYP_SUPABASE_PROJECT_REF: project,
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    NEXT_PUBLIC_APP_URL: "https://wouldyoupeek.vercel.app",
    WYP_SUPPORT_EMAIL: "support@example.com",
    WYP_TURNSTILE_SITE_KEY: "0x4AAABBBCCCDDDEEEFFF",
  }).forEach(([k, v]) => vi.stubEnv(k, v));
}
beforeEach(hosted);
afterEach(() => vi.unstubAllEnvs());
describe("deployment configuration", () => {
  it("returns only an explicitly valid hosted configuration", () => {
    expect(getServerAppConfig()).toMatchObject({
      deploymentMode: "hosted",
      releaseEnvironment: "production",
      appOrigin: "https://wouldyoupeek.vercel.app",
    });
  });
  it.each([
    ["WYP_DEPLOYMENT_MODE", ""],
    ["WYP_DEPLOYMENT_MODE", "local"],
    ["WYP_RELEASE_ENVIRONMENT", "local"],
    ["VERCEL_ENV", "preview"],
    ["WYP_SUPABASE_PROJECT_REF", "wrong"],
    ["NEXT_PUBLIC_APP_URL", "http://wouldyoupeek.vercel.app"],
    ["NEXT_PUBLIC_APP_URL", "https://localhost"],
    ["NEXT_PUBLIC_APP_URL", "https://wouldyoupeek.vercel.app/path"],
    ["NEXT_PUBLIC_APP_URL", "https://name:pass@example.com"],
    ["WYP_SUPPORT_EMAIL", ""],
    ["WYP_SUPPORT_EMAIL", "mailto:support@example.com"],
    ["WYP_TURNSTILE_SITE_KEY", ""],
    ["WYP_TURNSTILE_SITE_KEY", "1x00000000000000000000AA"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_secret_not_public"],
  ])("fails closed for %s", (key, value) => {
    vi.stubEnv(key, value);
    expect(getServerAppConfig).toThrow();
  });
  it("permits only explicit loopback local operation", () => {
    vi.stubEnv("WYP_DEPLOYMENT_MODE", "local");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("WYP_RELEASE_ENVIRONMENT", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100");
    expect(getServerAppConfig()).toMatchObject({
      deploymentMode: "local",
      releaseEnvironment: "local",
      supportEmail: null,
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${project}.supabase.co`);
    expect(getServerAppConfig).toThrow();
  });
  it("rejects legacy service-role credentials", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
    );
    expect(getServerAppConfig).toThrow();
  });
});
