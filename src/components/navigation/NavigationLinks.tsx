"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavigationLinks({
  signedIn,
  creator,
}: {
  signedIn: boolean;
  creator: boolean;
}) {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Home" },
    { href: "/library", label: "Library" },
    ...(signedIn ? [{ href: "/history", label: "History" }] : []),
    ...(creator ? [{ href: "/creator", label: "Creator" }] : []),
    ...(signedIn ? [{ href: "/account", label: "Account" }] : []),
  ];
  return (
    <nav className="site-nav" aria-label="Main navigation">
      {links.map(({ href, label }) => {
        const active =
          href === "/"
            ? pathname === "/"
            : pathname === href ||
              pathname.startsWith(`${href}/`) ||
              (href === "/library" && pathname.startsWith("/play/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
      {!signedIn && (
        <>
          <Link href="/sign-in">Sign in</Link>
          <Link href="/sign-up" className="nav-accent">
            Join the lab ↗
          </Link>
        </>
      )}
    </nav>
  );
}
