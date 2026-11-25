import type { MetadataRoute } from "next";
import { getServerAppConfig } from "@/server/config";

export default function robots(): MetadataRoute.Robots {
  const config = getServerAppConfig();
  return {
    rules: {
      userAgent: "*",
      ...(config.releaseEnvironment === "production"
        ? {
            allow: "/",
            disallow: [
              "/auth/",
              "/sign-in",
              "/sign-up",
              "/check-email",
              "/forgot-password",
              "/reset-password",
              "/account",
              "/history",
              "/play",
              "/creator",
              "/operator",
              "/api/",
            ],
          }
        : { disallow: "/" }),
    },
  };
}
