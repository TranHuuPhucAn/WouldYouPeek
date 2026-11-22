import "server-only";
import type { Metadata } from "next";
import { getServerAppConfig } from "./config";

const description =
  "Watch real Valorant POVs, make your call, and return to saved decisions and debriefs.";
const bounded = (value: string, limit: number) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, limit);

export function getSiteMetadata(): Metadata {
  const config = getServerAppConfig();
  return {
    metadataBase: new URL(config.appOrigin),
    title: {
      default: "Would You Peek? — Make the call",
      template: "%s | Would You Peek?",
    },
    description,
    robots:
      config.releaseEnvironment === "production"
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

export function getPublicPageMetadata({
  title,
  description: summary = description,
  path,
}: {
  title: string;
  description?: string;
  path: string;
}): Metadata {
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(path) || path.includes("//"))
    throw new Error("Invalid canonical page path.");
  const config = getServerAppConfig();
  const canonical = new URL(path, config.appOrigin).href;
  const safeTitle = bounded(title, 160);
  const safeDescription = bounded(summary, 320);
  return {
    title: safeTitle,
    description: safeDescription,
    alternates: { canonical },
    openGraph: {
      title: safeTitle,
      description: safeDescription,
      url: canonical,
      siteName: "Would You Peek?",
      type: "website",
    },
    robots:
      config.releaseEnvironment === "production"
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

export function getPrivatePageMetadata(title: string): Metadata {
  return {
    title: bounded(title, 160),
    robots: { index: false, follow: false },
  };
}

export function getUnavailableMetadata(title: string): Metadata {
  return {
    ...getPrivatePageMetadata(title),
    description:
      "This content is unavailable. Browse the Library to find another scenario.",
    alternates: { canonical: null },
  };
}
