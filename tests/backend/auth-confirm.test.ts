import { describe, it, expect, vi, beforeEach } from "vitest";
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/service", () => ({ verifyEmailToken: verify }));
vi.mock("@/server/config", () => ({
  getServerAppConfig: () => ({ appOrigin: "http://127.0.0.1:3000" }),
}));
import { GET, HEAD } from "@/app/auth/confirm/route";
const token = "a".repeat(64);
beforeEach(() => verify.mockReset());
describe("scanner-safe email callback", () => {
  it.each([GET, HEAD])(
    "safe reads redirect to explicit confirmation without verifying",
    async (handler) => {
      const response = await handler(
        new Request(
          `http://evil.test/auth/confirm?type=signup&token_hash=${token}&next=/account`,
        ),
      );
      expect(response.status).toBe(303);
      const destination = new URL(response.headers.get("location")!);
      expect(destination.origin).toBe("http://127.0.0.1:3000");
      expect(destination.pathname).toBe("/auth/confirm-email");
      expect(destination.searchParams.get("next")).toBe("/account");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(verify).not.toHaveBeenCalled();
    },
  );
  it("retains recovery intent without creating a session", async () => {
    const response = await GET(
      new Request(
        `http://localhost/auth/confirm?type=recovery&token_hash=${token}&next=//evil`,
      ),
    );
    const next = new URL(response.headers.get("location")!);
    expect(next.searchParams.get("type")).toBe("recovery");
    expect(next.searchParams.get("next")).toBe("/reset-password");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "type=invite&token_hash=secret",
    "type=signup",
    `type=signup&type=recovery&token_hash=${token}`,
    `type=signup&token_hash=${token}&next=/account&next=/library`,
  ])("rejects malformed or ambiguous input", async (query) => {
    const response = await GET(
      new Request("http://localhost/auth/confirm?" + query),
    );
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/auth/error");
    expect(destination.searchParams.has("token_hash")).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  });
});
