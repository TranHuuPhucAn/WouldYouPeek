import { getPrivatePageMetadata } from "@/server/metadata";
export const metadata = getPrivatePageMetadata("Operator reports");
import type { ReactNode } from "react";
import Link from "next/link";
import { requireOperatorPage } from "./access";
export default async function OperatorLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireOperatorPage("/operator/reports");
  return (
    <>
      <nav className="page-shell operator-nav" aria-label="Operator">
        <Link href="/account" className="text-button">
          ← Account
        </Link>
        <Link href="/operator/reports" className="text-button">
          Scenario reports
        </Link>
      </nav>
      {children}
    </>
  );
}
