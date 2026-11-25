"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DeploymentCapabilities } from "@/contracts/deployment";
export function CreatorSectionNav({
  capabilities = { sourceMode: "youtube-only" },
}: {
  capabilities?: DeploymentCapabilities;
}) {
  const path = usePathname();
  return (
    <nav className="section-nav" aria-label="Creator sections">
      {[
        ["/creator", "Scenarios"],
        ["/creator/playlists", "Playlists"],
        ...(capabilities.sourceMode === "youtube-and-upload"
          ? [["/creator/videos", "Your videos"]]
          : []),
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
