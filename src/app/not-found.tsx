import Link from "next/link";
export default function NotFound() {
  return (
    <main className="status-panel">
      <h1>This page isn’t available.</h1>
      <p>Check the link, or choose where you’d like to continue.</p>
      <div className="stack-actions">
        <Link href="/" className="button button-primary">
          Back to home
        </Link>
        <Link href="/library" className="text-button">
          Scenario library
        </Link>
        <Link href="/history" className="text-button">
          Session history
        </Link>
        <Link href="/creator" className="text-button">
          Creator workspace
        </Link>
      </div>
    </main>
  );
}
