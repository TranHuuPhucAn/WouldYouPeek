"use client";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
export function ResendVerificationForm({
  returnTo = "/library",
}: {
  returnTo?: string;
}) {
  return (
    <AuthForm
      returnTo={returnTo}
      action={resendVerificationAction}
      fields={["email"]}
      label="Resend verification email"
    />
  );
}
