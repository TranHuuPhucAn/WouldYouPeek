import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendVerification: vi.fn(),
  updatePassword: vi.fn(),
  signOut: vi.fn(),
  verifyEmailToken: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/server/auth/service", () => mocks);
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/config", () => ({
  getServerAppConfig: () => ({ appOrigin: "http://127.0.0.1:3000" }),
}));
import {
  signUpAction,
  signInAction,
  requestResetAction,
  resendVerificationAction,
  updatePasswordAction,
  signOutAction,
  confirmEmailAction,
} from "@/app/(auth)/actions";
import { AuthValidationError } from "@/server/auth/validation";
import { ApiError } from "@/server/http";
const idle = { status: "idle" as const };
function form(fields: Record<string, string>) {
  const data = new FormData();
  Object.entries(fields).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) =>
    mock.mockReset().mockResolvedValue(undefined),
  );
  mocks.headers.mockResolvedValue(
    new Headers({ origin: "http://127.0.0.1:3000" }),
  );
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error("REDIRECT:" + path);
  });
});
describe("auth action adapters", () => {
  it("returns accessible errors without echoing credentials", async () => {
    mocks.signIn.mockRejectedValue(
      new AuthValidationError({ email: "Bad email" }),
    );
    expect(
      await signInAction(idle, form({ email: "bad", password: "secret" })),
    ).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: { email: "Bad email" },
    });
  });
  it("redirects sign-in safely outside error capture", async () => {
    await expect(
      signInAction(
        idle,
        form({ email: "a@b.com", password: "secret", returnTo: "//evil" }),
      ),
    ).rejects.toThrow("REDIRECT:/library");
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("ignores signup role metadata and uses check email destination", async () => {
    await expect(
      signUpAction(
        idle,
        form({
          email: "a@b.com",
          password: "Abcd123!",
          confirmPassword: "Abcd123!",
          role: "creator",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/check-email?returnTo=%2Flibrary");
    expect(mocks.signUp.mock.calls[0][0]).not.toHaveProperty("role");
  });
  it("retains the selected scenario through signup and verification resend", async () => {
    const returnTo = "/library/bind-clove-utility-window";
    await expect(
      signUpAction(
        idle,
        form({
          email: "a@b.com",
          password: "Abcd123!",
          confirmPassword: "Abcd123!",
          returnTo,
        }),
      ),
    ).rejects.toThrow(
      `REDIRECT:/check-email?returnTo=${encodeURIComponent(returnTo)}`,
    );
    expect(mocks.signUp).toHaveBeenCalledWith(expect.any(Object), returnTo);
    await resendVerificationAction(idle, form({ email: "a@b.com", returnTo }));
    expect(mocks.resendVerification).toHaveBeenCalledWith(
      { email: "a@b.com" },
      returnTo,
    );
    await resendVerificationAction(
      idle,
      form({ email: "a@b.com", returnTo: "//evil" }),
    );
    expect(mocks.resendVerification).toHaveBeenLastCalledWith(
      { email: "a@b.com" },
      "/library",
    );
  });
  it("returns generic reset and resend messaging", async () => {
    expect(
      await requestResetAction(idle, form({ email: "a@b.com" })),
    ).toMatchObject({
      status: "success",
      message: expect.stringContaining("If this email"),
    });
    expect(
      await resendVerificationAction(idle, form({ email: "a@b.com" })),
    ).toMatchObject({
      status: "success",
      message: expect.stringContaining("If this account"),
    });
  });
  it("does not invent retry timing on throttling", async () => {
    mocks.requestPasswordReset.mockRejectedValue(
      new ApiError("RATE_LIMITED", "Wait"),
    );
    expect(await requestResetAction(idle, form({ email: "a@b.com" }))).toEqual({
      status: "error",
      message: "Wait",
    });
  });
  it("redirects after successful password update and sign-out", async () => {
    await expect(
      updatePasswordAction(
        idle,
        form({ password: "Abcd123!", confirmPassword: "Abcd123!" }),
      ),
    ).rejects.toThrow("REDIRECT:/account?password=updated");
    await expect(signOutAction()).rejects.toThrow("REDIRECT:/sign-in");
  });
});

describe("explicit email confirmation action", () => {
  const token = "a".repeat(64);
  it("verifies a single same-origin POST and redirects outside error capture", async () => {
    await expect(
      confirmEmailAction(
        idle,
        form({
          token_hash: token,
          type: "signup",
          returnTo: "/operator/reports",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/operator/reports");
    expect(mocks.verifyEmailToken).toHaveBeenCalledExactlyOnceWith(
      token,
      "signup",
    );
  });
  it("returns a safe error for used links and never echoes token", async () => {
    mocks.verifyEmailToken.mockRejectedValue(
      new ApiError("INVALID_REQUEST", "Request a new link."),
    );
    const result = await confirmEmailAction(
      idle,
      form({ token_hash: token, type: "recovery" }),
    );
    expect(result).toEqual({ status: "error", message: "Request a new link." });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it.each([null, "https://evil.example"])(
    "rejects untrusted origin %s",
    async (origin) => {
      mocks.headers.mockResolvedValue(new Headers(origin ? { origin } : {}));
      expect(
        await confirmEmailAction(
          idle,
          form({ token_hash: token, type: "signup" }),
        ),
      ).toMatchObject({ status: "error" });
      expect(mocks.verifyEmailToken).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate token and challenge fields", async () => {
    const input = form({ token_hash: token, type: "signup" });
    input.append("token_hash", token);
    expect(await confirmEmailAction(idle, input)).toMatchObject({
      status: "error",
    });
    expect(mocks.verifyEmailToken).not.toHaveBeenCalled();
    const signin = form({
      email: "a@b.com",
      password: "secret",
      captchaToken: "first",
    });
    signin.append("captchaToken", "second");
    expect(await signInAction(idle, signin)).toMatchObject({ status: "error" });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
  it("preserves trustworthy retry timing without guessing", async () => {
    mocks.requestPasswordReset.mockRejectedValue(
      new ApiError("RATE_LIMITED", "Wait", undefined, 120),
    );
    expect(await requestResetAction(idle, form({ email: "a@b.com" }))).toEqual({
      status: "error",
      message: "Wait",
      retryAfter: 120,
    });
  });
});
