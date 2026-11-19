import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import * as actions from "@/app/(auth)/actions";
import { SignInForm } from "@/components/auth/SignInForm";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ResendVerificationForm } from "@/components/auth/ResendVerificationForm";
vi.mock("@/app/(auth)/actions", () => ({
  signInAction: vi.fn(async () => ({
    status: "error",
    message: "Email or password is incorrect.",
    fieldErrors: { email: "Check your email." },
  })),
  signUpAction: vi.fn(async () => ({
    status: "success",
    message: "Check your inbox.",
  })),
  requestResetAction: vi.fn(async () => ({
    status: "success",
    message:
      "If this email has an account, a password reset link is on its way.",
  })),
  updatePasswordAction: vi.fn(async () => ({
    status: "success",
    message: "Password updated.",
  })),
  resendVerificationAction: vi.fn(async () => ({
    status: "success",
    message: "If this account needs verification, a fresh link is on its way.",
  })),
}));
it("sends credential fields and safe destination while focusing server errors", async () => {
  const user = userEvent.setup();
  render(<SignInForm returnTo="/history" />);
  await user.type(screen.getByLabelText("Email"), "learner@example.test");
  await user.type(screen.getByLabelText("Password"), " WrongPassword123 ");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  const error = await screen.findByRole("alert");
  expect(error).toHaveFocus();
  const data = vi.mocked(actions.signInAction).mock.calls[0][1];
  expect(data.get("password")).toBe(" WrongPassword123 ");
  expect(data.get("returnTo")).toBe("/history");
  expect(screen.getByLabelText("Email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
it("does not submit a mismatched confirmation", async () => {
  const user = userEvent.setup();
  render(<SignUpForm />);
  await user.type(screen.getByLabelText("Email"), "learner@example.test");
  await user.type(screen.getByLabelText("New password"), "LongPassword123");
  await user.type(screen.getByLabelText("Confirm password"), "Different123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(actions.signUpAction).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Confirm password")).toBeInvalid();
});
it("shows generic reset response without revealing account existence", async () => {
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email"), "unknown@example.test");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "If this email has an account",
  );
});
it("supports verification resend", async () => {
  const user = userEvent.setup();
  render(<ResendVerificationForm />);
  await user.type(screen.getByLabelText("Email"), "learner@example.test");
  await user.click(
    screen.getByRole("button", { name: "Resend verification email" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("fresh link");
});
it("disables repeated submissions during recovery", async () => {
  let resolve!: (value: { status: "success"; message: string }) => void;
  vi.mocked(actions.updatePasswordAction).mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  const user = userEvent.setup();
  render(<ResetPasswordForm />);
  await user.type(screen.getByLabelText("New password"), "LongPassword123");
  await user.type(screen.getByLabelText("Confirm password"), "LongPassword123");
  await user.click(screen.getByRole("button", { name: "Update password" }));
  expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
  resolve({ status: "success", message: "Updated" });
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Updated"),
  );
});
