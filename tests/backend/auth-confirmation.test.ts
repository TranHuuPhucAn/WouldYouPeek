import { beforeEach, describe, expect, it, vi } from "vitest";
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/service", () => ({ verifyEmailToken: verify }));
import {
  parseConfirmationRequest,
  confirmEmail,
} from "@/server/auth/confirmation";
const token = "a".repeat(64);
const query = (extra = "") =>
  new URLSearchParams(`token_hash=${token}&type=signup${extra}`);
beforeEach(() => verify.mockReset().mockResolvedValue(undefined));
describe("confirmation input and explicit verification", () => {
  it("parses without consuming an OTP", () => {
    expect(parseConfirmationRequest(query("&next=%2Faccount"))).toEqual({
      tokenHash: token,
      type: "signup",
      returnTo: "/account",
    });
    expect(verify).not.toHaveBeenCalled();
  });
  it.each([
    "&token_hash=other",
    "&type=recovery",
    "&next=/account&next=/library",
    "&next=" + "x".repeat(513),
  ])("rejects ambiguous/bounded input", (suffix) => {
    expect(() => parseConfirmationRequest(query(suffix))).toThrow();
  });
  it.each([
    "",
    "type=signup",
    "type=signup&token_hash=short",
    `type=invite&token_hash=${token}`,
  ])("rejects unsupported input", (input) => {
    expect(() =>
      parseConfirmationRequest(new URLSearchParams(input)),
    ).toThrow();
  });
  it("restricts external destinations and pins recovery to its password form", () => {
    expect(
      parseConfirmationRequest(query("&next=https://evil.example")).returnTo,
    ).toBe("/library");
    const form = new FormData();
    form.set("token_hash", token);
    form.set("type", "recovery");
    form.set("returnTo", "/account");
    expect(parseConfirmationRequest(form, "returnTo").returnTo).toBe(
      "/reset-password",
    );
  });
  it("verifies exactly when explicitly called and returns safe destination", async () => {
    await expect(
      confirmEmail(parseConfirmationRequest(query("&next=/account"))),
    ).resolves.toBe("/account");
    expect(verify).toHaveBeenCalledExactlyOnceWith(token, "signup");
  });
});
