import Link from "next/link";
import { ResendVerificationForm } from "@/components/auth/ResendVerificationForm";
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">THE DECISION LAB</span>
        <h1>Check your inbox.</h1>
        <p className="auth-intro">
          Open the verification email to activate your account. If it hasn’t
          arrived, check spam or request another link below.
        </p>
        <ResendVerificationForm />
        <p className="auth-switch">
          Already verified? <Link href="/sign-in">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
