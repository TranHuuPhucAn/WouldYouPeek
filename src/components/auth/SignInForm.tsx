"use client";
import Link from "next/link";
import { signInAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
export function SignInForm({ returnTo = "/play" }: { returnTo?: string }) {
  return (
    <>
      <AuthForm
        action={signInAction}
        fields={["email", "password"]}
        label="Sign in"
        returnTo={returnTo}
      />
      <p className="auth-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/check-email">Resend verification</Link>
      </p>
    </>
  );
}
