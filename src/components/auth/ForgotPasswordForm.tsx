"use client";
import { requestResetAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
export function ForgotPasswordForm() {
  return (
    <AuthForm
      action={requestResetAction}
      fields={["email"]}
      label="Send reset link"
    />
  );
}
