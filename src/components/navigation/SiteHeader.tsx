import Link from "next/link";
import type { AccountUser } from "@/contracts/auth";
import { NavigationLinks } from "./NavigationLinks";
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
      <NavigationLinks
        signedIn={!!viewer}
        creator={viewer?.role === "creator"}
      />
    </header>
  );
}
