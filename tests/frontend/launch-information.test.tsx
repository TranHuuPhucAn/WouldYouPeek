import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import HelpPage from "@/app/help/page";
import PrivacyPage from "@/app/privacy/page";
import { SiteFooter } from "@/components/SiteFooter";
import ConfirmEmailPage from "@/app/auth/confirm-email/page";
import { verifyEmailToken } from "@/server/auth/service";

const config = vi.hoisted(() => ({
  appOrigin: "https://would-you-peek.example",
  releaseEnvironment: "production",
  supportEmail: "support@example.test" as string | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/config", () => ({ getServerAppConfig: () => config }));
vi.mock("@/server/auth/service", () => ({ verifyEmailToken: vi.fn() }));
vi.mock("@/app/(auth)/actions", () => ({ confirmEmailAction: vi.fn() }));
beforeEach(() => {
  config.releaseEnvironment = "production";
  config.supportEmail = "support@example.test";
});

it("offers guest help, a real configured contact and footer destinations", () => {
  render(
    <>
      <HelpPage />
      <SiteFooter />
    </>,
  );
  expect(
    screen.getByRole("heading", { name: "A little context helps." }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "support@example.test" }),
  ).toHaveAttribute("href", "mailto:support@example.test");
  expect(
    screen.getByRole("navigation", { name: "Help and information" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  expect(
    screen.queryByText(/local installation can also support/),
  ).not.toBeInTheDocument();
});

it("describes actual public/private data and support without promising deletion automation", () => {
  render(<PrivacyPage />);
  expect(screen.getByText(/Creator drafts are private/)).toBeVisible();
  expect(
    screen.getByText(/no self-service account deletion feature/),
  ).toBeVisible();
  expect(screen.getByText(/Cloudflare Turnstile/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Get help using the app →" }),
  ).toHaveAttribute("href", "/help");
});

it("does not invent a support address for a local installation", () => {
  config.releaseEnvironment = "local";
  config.supportEmail = null;
  render(<HelpPage />);
  expect(screen.getByText(/no support email configured/)).toBeVisible();
  expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
});

it("renders a valid confirmation link without consuming the token", async () => {
  render(
    await ConfirmEmailPage({
      searchParams: Promise.resolve({
        type: "signup",
        token_hash: "a".repeat(64),
        next: "/history",
      }),
    }),
  );
  expect(screen.getByRole("button", { name: "Verify email" })).toBeVisible();
  expect(verifyEmailToken).not.toHaveBeenCalled();
  expect(document.querySelector('input[name="returnTo"]')).toHaveValue(
    "/history",
  );
  expect(screen.queryByText("a".repeat(64))).not.toBeInTheDocument();
});

it("recovery landing offers an explicit password-reset step", async () => {
  render(
    await ConfirmEmailPage({
      searchParams: Promise.resolve({
        type: "recovery",
        token_hash: "a".repeat(64),
        next: "/history",
      }),
    }),
  );
  expect(
    screen.getByRole("button", { name: "Continue to reset password" }),
  ).toBeVisible();
  expect(document.querySelector('input[name="returnTo"]')).toHaveValue(
    "/reset-password",
  );
  expect(verifyEmailToken).not.toHaveBeenCalled();
});

it("duplicate token inputs show recovery without rendering a submission token", async () => {
  render(
    await ConfirmEmailPage({
      searchParams: Promise.resolve({
        type: "signup",
        token_hash: ["a".repeat(64), "b".repeat(64)],
        next: "//attacker.example",
      }),
    }),
  );
  expect(
    screen.getByRole("heading", { name: "This link couldn’t be verified." }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Verify email" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('input[name="token_hash"]')).toBeNull();
  expect(verifyEmailToken).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
    "href",
    "/sign-in?returnTo=%2Flibrary",
  );
});
