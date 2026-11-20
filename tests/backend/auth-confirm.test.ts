import { describe, it, expect, vi, beforeEach } from "vitest";
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/service", () => ({ verifyEmailToken: verify }));
vi.mock("@/server/config", () => ({
  getServerAppConfig: () => ({ appOrigin: "http://127.0.0.1:3000" }),
}));
import { GET } from "@/app/auth/confirm/route";
beforeEach(() => {
  verify.mockReset().mockResolvedValue(undefined);
});
describe("email confirmation callback", () => {
  it("recovers to reset page and never echoes token", async () => {
    const response = await GET(
      new Request(
        "http://evil.test/auth/confirm?type=recovery&token_hash=secret&next=//evil.test",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/reset-password",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("restricts signup redirects", async () => {
    const response = await GET(
      new Request(
        "http://localhost/auth/confirm?type=signup&token_hash=secret&next=//evil.test",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/library",
    );
  });
  it.each(["type=invite&token_hash=secret", "type=signup", ""])(
    "denies unsupported/incomplete links %s",
    async (query) => {
      const response = await GET(
        new Request("http://localhost/auth/confirm?" + query),
      );
      expect(response.headers.get("location")).toContain("/auth/error");
      expect(verify).not.toHaveBeenCalled();
    },
  );
  it("handles invalid or reused OTP", async () => {
    verify.mockRejectedValue(new Error("expired token"));
    const response = await GET(
      new Request(
        "http://localhost/auth/confirm?type=signup&token_hash=secret",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/auth/error?returnTo=%2Flibrary",
    );
  });
  it("preserves a chosen scenario on success and expired-link recovery", async () => {
    const next = "/library/bind-clove-utility-window";
    const url = `http://localhost/auth/confirm?type=signup&token_hash=secret&next=${encodeURIComponent(next)}`;
    expect((await GET(new Request(url))).headers.get("location")).toBe(
      `http://127.0.0.1:3000${next}`,
    );
    verify.mockRejectedValue(new Error("expired secret"));
    const failure = new URL(
      (await GET(new Request(url))).headers.get("location")!,
    );
    expect(failure.pathname).toBe("/auth/error");
    expect(failure.searchParams.get("returnTo")).toBe(next);
    expect(failure.toString()).not.toContain("secret");
  });
  it("rejects ambiguous token/type values and discards ambiguous next", async () => {
    await GET(
      new Request(
        "http://localhost/auth/confirm?type=signup&type=recovery&token_hash=secret",
      ),
    );
    expect(verify).not.toHaveBeenCalled();
    const result = await GET(
      new Request(
        "http://localhost/auth/confirm?type=signup&token_hash=secret&next=/account&next=//evil",
      ),
    );
    expect(result.headers.get("location")).toBe(
      "http://127.0.0.1:3000/library",
    );
  });
});
