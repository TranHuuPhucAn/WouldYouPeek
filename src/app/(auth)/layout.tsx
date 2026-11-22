import type { ReactNode } from "react";
import { getPrivatePageMetadata } from "@/server/metadata";
export const metadata = getPrivatePageMetadata("Account access");
export default function PrivateLayout({ children }: { children: ReactNode }) {
  return children;
}
