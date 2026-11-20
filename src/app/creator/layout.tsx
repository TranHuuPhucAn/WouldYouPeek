import type { ReactNode } from "react";
import { CreatorSectionNav } from "@/components/creator/CreatorSectionNav";
export default function CreatorLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="page-shell creator-navigation-shell">
        <CreatorSectionNav />
      </div>
      {children}
    </>
  );
}
