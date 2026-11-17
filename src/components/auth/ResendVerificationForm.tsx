"use client";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
export function ResendVerificationForm() {
  return (
    <AuthForm
      action={resendVerificationAction}
      fields={["email"]}
      label="Resend verification email"
    />
  );
}
