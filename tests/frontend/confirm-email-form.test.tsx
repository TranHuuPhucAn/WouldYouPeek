import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfirmEmailForm } from "@/components/auth/ConfirmEmailForm";
import { confirmEmailAction } from "@/app/(auth)/actions";

vi.mock("@/app/(auth)/actions", () => ({ confirmEmailAction: vi.fn() }));

it("consumes nothing on mount/rerender and submits token/type/destination only on explicit confirmation", async () => {
  let finish!: (value: { status: "error"; message: string }) => void;
  vi.mocked(confirmEmailAction).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const props = {
    type: "signup" as const,
    tokenHash: "private-test-token",
    returnTo: "/history",
  };
  const view = render(<ConfirmEmailForm {...props} />);
  view.rerender(<ConfirmEmailForm {...props} />);
  expect(confirmEmailAction).not.toHaveBeenCalled();
  expect(screen.queryByText("private-test-token")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() => expect(confirmEmailAction).toHaveBeenCalledOnce());
  const input = vi.mocked(confirmEmailAction).mock.calls[0][1];
  expect(Object.fromEntries(input)).toEqual({
    token_hash: "private-test-token",
    type: "signup",
    returnTo: "/history",
  });
  expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
  await act(async () =>
    finish({ status: "error", message: "This link has expired." }),
  );
  expect(screen.getByRole("alert")).toHaveFocus();
  expect(
    screen.getByRole("link", { name: "Request a new verification link" }),
  ).toHaveAttribute("href", "/check-email?returnTo=%2Fhistory");
  expect(document.querySelector('script[src*="cloudflare"]')).toBeNull();
});

it("uses a separate recovery action label and safe retry destination", async () => {
  vi.mocked(confirmEmailAction).mockResolvedValueOnce({
    status: "error",
    message: "This link has already been used.",
  });
  render(
    <ConfirmEmailForm
      type="recovery"
      tokenHash="private-test-token"
      returnTo="/reset-password"
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to reset password" }),
  );
  expect(
    await screen.findByRole("link", { name: "Request a new reset link" }),
  ).toHaveAttribute("href", "/forgot-password");
  for (const link of screen.getAllByRole("link"))
    expect(link.getAttribute("href")).not.toContain("private-test-token");
});
