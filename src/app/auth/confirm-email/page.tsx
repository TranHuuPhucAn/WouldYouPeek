import { ConfirmEmailForm } from "@/components/auth/ConfirmEmailForm";
import { parseConfirmationRequest } from "@/server/auth/confirmation";
import { ApiError } from "@/server/http";
import AuthErrorPage from "../error/page";

export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const parameters = new URLSearchParams();
  for (const [name, values] of Object.entries(query)) {
    for (const value of Array.isArray(values)
      ? values
      : values === undefined
        ? []
        : [values])
      parameters.append(name, value);
  }
  let confirmation;
  try {
    confirmation = parseConfirmationRequest(parameters);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return AuthErrorPage({
      searchParams: Promise.resolve({ returnTo: query.next, type: query.type }),
    });
  }
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">ONE MORE STEP</span>
        <h1>
          {confirmation.type === "recovery"
            ? "Reset your password."
            : "Confirm your email."}
        </h1>
        <p className="auth-intro">
          {confirmation.type === "recovery"
            ? "Continue below to choose a new password for your account."
            : "Select Verify email to activate your account and continue to your decisions."}
        </p>
        <ConfirmEmailForm {...confirmation} />
      </section>
    </main>
  );
}
