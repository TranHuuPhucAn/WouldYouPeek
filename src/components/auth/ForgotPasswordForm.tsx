"use client";
import { requestResetAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
import type { AuthChallengeConfig } from "@/contracts/auth";
export function ForgotPasswordForm({
  challenge,
}: {
  challenge?: AuthChallengeConfig;
}) {
  return (
    <AuthForm
      challenge={challenge}
      action={requestResetAction}
      fields={["email"]}
      label="Send reset link"
    />
  );
}
