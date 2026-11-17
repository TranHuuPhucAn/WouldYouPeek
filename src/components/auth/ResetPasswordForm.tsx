"use client";
import { updatePasswordAction } from "@/app/(auth)/actions";
import { AuthForm } from "./AuthForm";
export function ResetPasswordForm() {
  return (
    <AuthForm
      action={updatePasswordAction}
      fields={["password", "confirmPassword"]}
      label="Update password"
      newPassword
    />
  );
}
