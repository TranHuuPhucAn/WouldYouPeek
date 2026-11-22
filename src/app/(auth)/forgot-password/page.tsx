import { getAuthChallengeConfig } from "@/server/auth/challenge";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">THE DECISION LAB</span>
        <h1>Get back into the lab.</h1>
        <p className="auth-intro">
          Enter your email and we’ll send a link to set a new password.
        </p>
        <ForgotPasswordForm challenge={getAuthChallengeConfig()} />
        <p className="auth-switch">
          Remembered your password? <Link href="/sign-in">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
