import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disposable verification copies must trace only their own installed project.
  outputFileTracingRoot: process.cwd(),
  async headers() {
    const privatePaths = [
      "/auth/:path*",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/reset-password",
      "/check-email",
      "/play/:path*",
      "/history",
      "/account",
      "/creator/:path*",
      "/operator/:path*",
    ];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env.WYP_RELEASE_ENVIRONMENT === "preview"
            ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
            : []),
        ],
      },
      ...privatePaths.map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      })),
      {
        source: "/auth/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
