import Link from "next/link";
import { SignInForm } from "@/components/auth/SignInForm";
import { getCurrentAccount } from "@/server/auth/guards";
import { safeReturnTo } from "@/server/auth/redirects";
import { redirect } from "next/navigation";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo);
  const viewer = await getCurrentAccount();
  if (viewer?.emailVerified) redirect(returnTo);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">THE DECISION LAB</span>
        <h1>Welcome back.</h1>
        <p className="auth-intro">
          Your decisions are waiting. Sign in to resume or begin a session.
        </p>
        <SignInForm returnTo={returnTo} />
        <p className="auth-switch">
          New to the lab?{" "}
          <Link href={`/sign-up?returnTo=${encodeURIComponent(returnTo)}`}>
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
