import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  client: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      resend: vi.fn(),
      verifyOtp: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
  requireVerifiedUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.client),
}));
vi.mock("@/server/auth/guards", () => ({
  requireVerifiedUser: mocks.requireVerifiedUser,
}));
vi.mock("@/server/auth/redirects", () => ({
  buildAuthRedirect: vi.fn(() => "http://127.0.0.1:3000/auth/confirm"),
}));
import * as auth from "@/server/auth/service";
beforeEach(() => {
  for (const fn of Object.values(mocks.client.auth))
    fn.mockReset().mockResolvedValue({ error: null });
  mocks.requireVerifiedUser.mockReset().mockResolvedValue({ id: "u" });
});
describe("auth provider operations", () => {
  it("signs up without accepting role metadata", async () => {
    await auth.signUp({
      email: "a@b.com",
      password: "Password12345",
      confirmPassword: "Password12345",
    });
    expect(mocks.client.auth.signUp).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "Password12345",
      options: { emailRedirectTo: "http://127.0.0.1:3000/auth/confirm" },
    });
  });
  it("maps sign-in failures without provider detail", async () => {
    mocks.client.auth.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", message: "private detail" },
    });
    await expect(
      auth.signIn({ email: "a@b.com", password: "bad" }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: "The email or password is incorrect.",
    });
  });
  it("preserves verification requirement", async () => {
    mocks.client.auth.signInWithPassword.mockResolvedValue({
      error: { code: "email_not_confirmed" },
    });
    await expect(
      auth.signIn({ email: "a@b.com", password: "bad" }),
    ).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });
  it("keeps account-existence outcomes generic", async () => {
    mocks.client.auth.resetPasswordForEmail.mockResolvedValue({
      error: { status: 400, code: "user_not_found" },
    });
    await expect(
      auth.requestPasswordReset({ email: "a@b.com" }),
    ).resolves.toBeUndefined();
    mocks.client.auth.resend.mockResolvedValue({
      error: { status: 400, code: "user_not_found" },
    });
    await expect(
      auth.resendVerification({ email: "a@b.com" }),
    ).resolves.toBeUndefined();
  });
  it("reports provider connectivity failures instead of claiming email delivery", async () => {
    mocks.client.auth.resetPasswordForEmail.mockResolvedValue({
      error: { status: 0 },
    });
    await expect(
      auth.requestPasswordReset({ email: "a@b.com" }),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });
  it("maps rate limiting", async () => {
    mocks.client.auth.resend.mockResolvedValue({ error: { status: 429 } });
    await expect(
      auth.resendVerification({ email: "a@b.com" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("verifies only token hashes and maps expired links", async () => {
    await auth.verifyEmailToken("a".repeat(64), "recovery");
    expect(mocks.client.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "a".repeat(64),
      type: "recovery",
    });
    mocks.client.auth.verifyOtp.mockResolvedValue({ error: { status: 403 } });
    await expect(
      auth.verifyEmailToken("a".repeat(64), "signup"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("requires verified identity before updating password", async () => {
    mocks.requireVerifiedUser.mockRejectedValue(new Error("denied"));
    await expect(
      auth.updatePassword({
        password: "Password12345",
        confirmPassword: "Password12345",
      }),
    ).rejects.toThrow("denied");
    expect(mocks.client.auth.updateUser).not.toHaveBeenCalled();
  });
  it("logs out only the current device", async () => {
    await auth.signOut();
    expect(mocks.client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
