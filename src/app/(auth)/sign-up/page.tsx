import { getAuthChallengeConfig } from "@/server/auth/challenge";
import Link from "next/link";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { getCurrentAccount } from "@/server/auth/guards";
import { safeReturnTo } from "@/server/auth/redirects";
import { redirect } from "next/navigation";
export default async function SignUpPage({
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
        <h1>Make your next call.</h1>
        <p className="auth-intro">
          Create an account to play, save your progress and revisit every
          debrief.
        </p>
        <SignUpForm challenge={getAuthChallengeConfig()} returnTo={returnTo} />
        <p className="auth-switch">
          Already have an account?{" "}
          <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
