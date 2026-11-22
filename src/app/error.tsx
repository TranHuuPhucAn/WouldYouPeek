"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="status-panel" role="alert">
      <h1>We couldn’t load this page.</h1>
      <p>
        Your saved progress is still yours. Try again when the connection is
        back.
      </p>
      <div className="stack-actions">
        <button className="button button-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="text-button">
          Back to home
        </Link>
        <Link href="/help" className="text-button">
          Get help
        </Link>
      </div>
    </main>
  );
}
