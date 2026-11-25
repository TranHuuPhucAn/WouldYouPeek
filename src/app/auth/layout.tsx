import type { ReactNode } from "react";
import { getPrivatePageMetadata } from "@/server/metadata";
export const metadata = getPrivatePageMetadata("Confirm your account");
export default function PrivateLayout({ children }: { children: ReactNode }) {
  return children;
}
