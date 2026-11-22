"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { AuthFormState } from "@/contracts/auth";
import * as auth from "@/server/auth/service";
import { safeReturnTo } from "@/server/auth/redirects";
import { AuthValidationError } from "@/server/auth/validation";
import { ApiError } from "@/server/http";
import {
  confirmEmail,
  parseConfirmationRequest,
} from "@/server/auth/confirmation";
import { getServerAppConfig } from "@/server/config";

function fields(data: FormData, names: string[]) {
  return Object.fromEntries(
    names.flatMap((name) => {
      const values = data.getAll(name);
      if (values.length > 1)
        throw new ApiError(
          "INVALID_REQUEST",
          "Send each account field only once.",
        );
      return name === "captchaToken" && values.length === 0
        ? []
        : [[name, values[0] ?? null]];
    }),
  );
}
function failure(error: unknown): AuthFormState {
  if (error instanceof AuthValidationError)
    return {
      status: "error",
      message: error.message,
      fieldErrors: error.fieldErrors,
    };
  if (error instanceof ApiError)
    return {
      status: "error",
      message: error.message,
      ...(error.code === "RATE_LIMITED" &&
      Number.isSafeInteger(error.retryAfter) &&
      error.retryAfter! > 0 &&
      error.retryAfter! <= 86400
        ? { retryAfter: error.retryAfter }
        : {}),
    };
  return {
    status: "error",
    message: "Account services are unavailable. Please try again.",
  };
}
export async function signUpAction(
  _previous: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  const returnTo = safeReturnTo(data.get("returnTo"));
  try {
    await auth.signUp(
      fields(data, ["email", "password", "confirmPassword", "captchaToken"]),
      returnTo,
    );
  } catch (error) {
    return failure(error);
  }
  redirect(`/check-email?returnTo=${encodeURIComponent(returnTo)}`);
}
export async function signInAction(
  _previous: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  try {
    await auth.signIn(fields(data, ["email", "password", "captchaToken"]));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect(safeReturnTo(data.get("returnTo")));
}
export async function requestResetAction(
  _previous: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  try {
    await auth.requestPasswordReset(fields(data, ["email", "captchaToken"]));
    return {
      status: "success",
      message:
        "If this email has an account, a password reset link is on its way.",
    };
  } catch (error) {
    return failure(error);
  }
}
export async function resendVerificationAction(
  _previous: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  try {
    await auth.resendVerification(
      fields(data, ["email", "captchaToken"]),
      safeReturnTo(data.get("returnTo")),
    );
    return {
      status: "success",
      message:
        "If this account needs verification, a fresh link is on its way.",
    };
  } catch (error) {
    return failure(error);
  }
}
export async function updatePasswordAction(
  _previous: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  try {
    await auth.updatePassword(fields(data, ["password", "confirmPassword"]));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect("/account?password=updated");
}
export async function signOutAction(): Promise<void> {
  await auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}

export async function confirmEmailAction(
  _previous: AuthFormState,
  data: FormData,
): Promise<AuthFormState> {
  let destination: string;
  try {
    const requestHeaders = await headers();
    if (
      requestHeaders.get("origin") !== getServerAppConfig().appOrigin ||
      requestHeaders.get("sec-fetch-site") === "cross-site"
    )
      throw new ApiError(
        "INVALID_REQUEST",
        "Open this email link in this application and try again.",
      );
    destination = await confirmEmail(
      parseConfirmationRequest(data, "returnTo"),
    );
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect(destination);
}
