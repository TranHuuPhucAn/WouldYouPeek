import { getCurrentAccount } from "@/server/auth/guards";
import { SiteHeader } from "@/components/navigation/SiteHeader";
import { AuthStateSync } from "@/components/auth/AuthStateSync";
import { SiteFooter } from "@/components/SiteFooter";
import { getSiteMetadata } from "@/server/metadata";
import "./globals.css";
export const generateMetadata = getSiteMetadata;
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
            <SiteFooter />
          </div>
        </AuthStateSync>
      </body>
    </html>
  );
}
