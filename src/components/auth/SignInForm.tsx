"use client";
import Link from "next/link";
import { signInAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
import type { AuthChallengeConfig } from "@/contracts/auth";
export function SignInForm({
  returnTo = "/library",
  challenge,
}: {
  returnTo?: string;
  challenge?: AuthChallengeConfig;
}) {
  return (
    <>
      <AuthForm
        challenge={challenge}
        action={signInAction}
        fields={["email", "password"]}
        label="Sign in"
        returnTo={returnTo}
      />
      <p className="auth-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href={`/check-email?returnTo=${encodeURIComponent(returnTo)}`}>
          Resend verification
        </Link>
      </p>
    </>
  );
}
