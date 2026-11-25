import type { ReactNode } from "react";
import { getPrivatePageMetadata } from "@/server/metadata";
export const metadata = getPrivatePageMetadata("Your training session");
export default function PrivateLayout({ children }: { children: ReactNode }) {
  return children;
}
