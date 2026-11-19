import type { Metadata } from "next";
import { getCurrentAccount } from "@/server/auth/guards";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { AuthStateSync } from "@/components/auth/AuthStateSync";
import "./globals.css";
export const metadata: Metadata = {
  title: "Would You Peek? — Make the call",
  description:
    "Watch real Valorant POVs, make your call, and return to saved decisions and debriefs.",
};
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const viewer = await getCurrentAccount();
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <AuthStateSync
          key={viewer?.id ?? "guest"}
          viewerId={viewer?.id ?? null}
          authSnapshotKey={crypto.randomUUID()}
        >
          <div className="app-shell">
            <SiteHeader viewer={viewer} />
            {children}
          </div>
        </AuthStateSync>
      </body>
    </html>
  );
}
