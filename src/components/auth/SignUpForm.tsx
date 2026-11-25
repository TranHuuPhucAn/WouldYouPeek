"use client";
import { signUpAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
import type { AuthChallengeConfig } from "@/contracts/auth";
export function SignUpForm({
  returnTo = "/library",
  challenge,
}: {
  returnTo?: string;
  challenge?: AuthChallengeConfig;
}) {
  return (
    <AuthForm
      challenge={challenge}
      action={signUpAction}
      fields={["email", "password", "confirmPassword"]}
      label="Create account"
      returnTo={returnTo}
      newPassword
    />
  );
}
