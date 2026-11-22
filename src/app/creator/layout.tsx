import { getPrivatePageMetadata } from "@/server/metadata";
export const metadata = getPrivatePageMetadata("Creator workspace");
import type { ReactNode } from "react";
import { CreatorSectionNav } from "@/components/creator/CreatorSectionNav";
import { getDeploymentCapabilities } from "@/server/deployment/capabilities";
export default async function CreatorLayout({
  children,
}: {
  children: ReactNode;
}) {
  const capabilities = await getDeploymentCapabilities();
  return (
    <>
      <div className="page-shell creator-navigation-shell">
        <CreatorSectionNav capabilities={capabilities} />
      </div>
      {children}
    </>
  );
}
