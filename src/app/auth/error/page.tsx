import Link from "next/link";
import { safeReturnTo } from "@/server/auth/redirects";
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = encodeURIComponent(
    safeReturnTo((await searchParams)?.returnTo),
  );
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
            href={`/check-email?returnTo=${returnTo}`}
            className="button button-primary"
          >
            Resend verification
          </Link>
          <Link href="/forgot-password" className="button button-secondary">
            Request a password reset
          </Link>
          <Link href={`/sign-in?returnTo=${returnTo}`} className="text-button">
            Back to sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
