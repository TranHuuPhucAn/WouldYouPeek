import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Would You Peek? — Make the call",
  description:
    "Three tactical scenarios. Make your call before the reveal, then explore the reasoning. A Valorant-inspired decision lab with original demo diagrams.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
