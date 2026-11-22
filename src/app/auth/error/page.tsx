import Link from "next/link";
import { safeReturnTo } from "@/server/auth/redirects";
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{
    returnTo?: string | string[];
    type?: string | string[];
  }>;
}) {
  const query = await searchParams;
  const recovery = query?.type === "recovery";
  const returnTo = encodeURIComponent(safeReturnTo(query?.returnTo));
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">LET’S TRY AGAIN</span>
        <h1>This link couldn’t be verified.</h1>
        <p className="auth-intro">
          It may have expired or already been used. Request a fresh link to
          continue.
        </p>
        <div className="stack-actions">
          <Link
            href={
              recovery
                ? "/forgot-password"
                : `/check-email?returnTo=${returnTo}`
            }
            className="button button-primary"
          >
            {recovery ? "Request a password reset" : "Resend verification"}
          </Link>
          <Link
            href={
              recovery
                ? `/check-email?returnTo=${returnTo}`
                : "/forgot-password"
            }
            className="button button-secondary"
          >
            {recovery ? "Resend verification" : "Request a password reset"}
          </Link>
          <Link href={`/sign-in?returnTo=${returnTo}`} className="text-button">
            Back to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
