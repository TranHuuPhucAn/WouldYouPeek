import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ApiError } from "@/server/http";
import { buildAuthRedirect } from "./redirects";
import { requireVerifiedUser } from "./guards";
import { parseCaptchaToken } from "./challenge";
import {
  parseNewPassword,
  parseResetRequest,
  parseSignInInput,
  parseSignUpInput,
} from "./validation";

type ProviderError = { code?: string; status?: number };
function authFailure(error: ProviderError, fallback: string): never {
  if (error.status === 429 || error.code?.includes("rate_limit"))
    throw new ApiError(
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
    );
  if (error.code === "captcha_failed")
    throw new ApiError(
      "INVALID_REQUEST",
      "The security check expired or failed. Complete it again and retry.",
    );
  if (error.code === "email_not_confirmed")
    throw new ApiError(
      "EMAIL_NOT_VERIFIED",
      "Verify your email before signing in.",
    );
  if (error.status === 0 || (error.status && error.status >= 500))
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Account services are temporarily unavailable. Please try again.",
    );
  throw new ApiError("INVALID_REQUEST", fallback);
}
export async function signUp(input: unknown, returnTo?: string) {
  const credentials = parseSignUpInput(input);
  const captchaToken = parseCaptchaToken(input);
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signUp({
    ...credentials,
    options: {
      emailRedirectTo: buildAuthRedirect("signup", returnTo),
      ...(captchaToken ? { captchaToken } : {}),
    },
  });
  if (
    error &&
    error.code !== "user_already_exists" &&
    error.code !== "email_exists"
  )
    authFailure(error, "We could not create the account. Please try again.");
}
export async function signIn(input: unknown) {
  const credentials = parseSignInInput(input);
  const captchaToken = parseCaptchaToken(input);
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signInWithPassword({
    ...credentials,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });
  if (error) authFailure(error, "The email or password is incorrect.");
}
export async function requestPasswordReset(input: unknown) {
  const { email } = parseResetRequest(input);
  const captchaToken = parseCaptchaToken(input);
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: buildAuthRedirect("recovery"),
    ...(captchaToken ? { captchaToken } : {}),
  });
  if (
    error &&
    (error.status === 429 ||
      error.code?.includes("rate_limit") ||
      error.code === "captcha_failed")
  )
    authFailure(error, "Please try again later.");
  if (error && (error.status === 0 || (error.status ?? 0) >= 500))
    authFailure(error, "Please try again later.");
}
export async function resendVerification(input: unknown, returnTo?: string) {
  const { email } = parseResetRequest(input);
  const captchaToken = parseCaptchaToken(input);
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: buildAuthRedirect("signup", returnTo),
      ...(captchaToken ? { captchaToken } : {}),
    },
  });
  if (
    error &&
    (error.status === 0 ||
      error.status === 429 ||
      error.code?.includes("rate_limit") ||
      error.code === "captcha_failed" ||
      (error.status ?? 0) >= 500)
  )
    authFailure(error, "Please try again later.");
}
export async function verifyEmailToken(
  tokenHash: string,
  type: "signup" | "recovery",
) {
  if (!/^[a-zA-Z0-9_-]{20,512}$/.test(tokenHash))
    throw new ApiError(
      "INVALID_REQUEST",
      "This email link is invalid or expired.",
    );
  const responseHeaders = new Headers();
  const client = await createServerSupabaseClient(responseHeaders);
  const { error } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });
  if (error)
    authFailure(
      error,
      "This email link is invalid or expired. Request a new link.",
    );
  return responseHeaders;
}
export async function updatePassword(input: unknown) {
  await requireVerifiedUser();
  const parsed = parseNewPassword(input);
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.updateUser(parsed);
  if (error)
    authFailure(
      error,
      "The password could not be updated. Please request a new reset link.",
    );
}
export async function signOut() {
  const client = await createServerSupabaseClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) authFailure(error, "Sign-out could not finish. Please try again.");
}
