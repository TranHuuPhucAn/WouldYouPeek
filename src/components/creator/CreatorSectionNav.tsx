"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function CreatorSectionNav() {
  const path = usePathname();
  return (
    <nav className="section-nav" aria-label="Creator sections">
      {[
        ["/creator", "Scenarios"],
        ["/creator/playlists", "Playlists"],
        ["/creator/videos", "Your videos"],
      ].map(([href, label]) => {
        const active =
          href === "/creator"
            ? !path.startsWith("/creator/playlists") &&
              !path.startsWith("/creator/videos")
            : path.startsWith(href);
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
    </nav>
  );
}
