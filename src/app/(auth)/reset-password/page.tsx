import { requirePageAccount } from "@/app/protected-page";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
export default async function ResetPasswordPage() {
  await requirePageAccount("/account");
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h1>Choose a new password.</h1>
        <p className="auth-intro">
          Keep access to your saved decisions with a strong password.
        </p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
