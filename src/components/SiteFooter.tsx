import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-information-footer">
      <span>Would You Peek? · Make the call.</span>
      <nav aria-label="Help and information">
        <Link href="/help">Help</Link>
        <Link href="/privacy">Privacy</Link>
      </nav>
    </footer>
  );
}
