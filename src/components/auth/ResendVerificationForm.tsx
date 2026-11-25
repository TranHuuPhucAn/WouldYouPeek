"use client";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
import type { AuthChallengeConfig } from "@/contracts/auth";
export function ResendVerificationForm({
  returnTo = "/library",
  challenge,
}: {
  returnTo?: string;
  challenge?: AuthChallengeConfig;
}) {
  return (
    <AuthForm
      challenge={challenge}
      returnTo={returnTo}
      action={resendVerificationAction}
      fields={["email"]}
      label="Resend verification email"
    />
  );
}
