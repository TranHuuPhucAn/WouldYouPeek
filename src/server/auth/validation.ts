import "server-only";
import {
  NEW_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_HINT,
  type AuthFormState,
} from "@/contracts/auth";

// Supabase Auth's supported symbol set; whitespace alone is not a symbol.
const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export class AuthValidationError extends Error {
  constructor(
    public fieldErrors: NonNullable<AuthFormState["fieldErrors"]>,
    message = "Check the highlighted fields.",
  ) {
    super(message);
  }
}
function record(value: unknown, allowed: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new AuthValidationError(
      {},
      "Send only the requested account fields.",
    );
  return value as Record<string, unknown>;
}
function email(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    throw new AuthValidationError({ email: "Enter a valid email address." });
  return value.trim().toLowerCase();
}
function password(value: unknown, newPassword: boolean): string {
  if (
    typeof value !== "string" ||
    value.length < (newPassword ? NEW_PASSWORD_MIN_LENGTH : 1) ||
    value.length > PASSWORD_MAX_LENGTH ||
    (newPassword &&
      (!/[A-Z]/.test(value) ||
        !/[a-z]/.test(value) ||
        !/[0-9]/.test(value) ||
        ![...value].some((character) => PASSWORD_SYMBOLS.includes(character))))
  )
    throw new AuthValidationError({
      password: newPassword ? NEW_PASSWORD_HINT : "Enter your password.",
    });
  return value;
}
export function parseSignInInput(value: unknown) {
  const input = record(value, ["email", "password", "captchaToken"]);
  return {
    email: email(input.email),
    password: password(input.password, false),
  };
}
export function parseSignUpInput(value: unknown) {
  const input = record(value, [
    "email",
    "password",
    "confirmPassword",
    "captchaToken",
  ]);
  return {
    email: email(input.email),
    ...parseNewPassword({
      password: input.password,
      confirmPassword: input.confirmPassword,
    }),
  };
}
export function parseResetRequest(value: unknown) {
  const input = record(value, ["email", "captchaToken"]);
  return { email: email(input.email) };
}
export function parseNewPassword(value: unknown) {
  const input = record(value, ["password", "confirmPassword"]);
  const result = password(input.password, true);
  if (input.confirmPassword !== result)
    throw new AuthValidationError({ confirmPassword: "Passwords must match." });
  return { password: result };
}
