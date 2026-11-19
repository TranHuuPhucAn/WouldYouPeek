import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
export function SiteHeader({ viewer }: { viewer: AccountUser | null }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Would You Peek home">
        <span className="brand-mark" aria-hidden="true">
          +
        </span>
        <span>
          WOULD YOU <strong>PEEK?</strong>
        </span>
      </Link>
      <nav className="site-nav" aria-label="Main navigation">
        <Link href="/demo">Demo</Link>
        {viewer ? (
          <>
            <Link href="/play">Play</Link>
            <Link href="/library">Library</Link>
            <Link href="/history">History</Link>
            {viewer.role === "creator" && <Link href="/creator">Creator</Link>}
            <Link href="/account">Account</Link>
          </>
        ) : (
          <>
            <Link href="/sign-in">Sign in</Link>
            <Link className="nav-accent" href="/sign-up">
              Join the lab ↗
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
