import Link from "next/link";
export default function NotFound() {
  return (
    <main className="status-panel">
      <h1>This session isn’t available.</h1>
      <p>Find your own saved sessions in your history.</p>
      <Link href="/history" className="button button-primary">
        Open session history
      </Link>
    </main>
  );
}
