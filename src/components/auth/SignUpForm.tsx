"use client";
import { signUpAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
export function SignUpForm({ returnTo = "/library" }: { returnTo?: string }) {
  return (
    <AuthForm
      action={signUpAction}
      fields={["email", "password", "confirmPassword"]}
      label="Create account"
      returnTo={returnTo}
      newPassword
    />
  );
}
