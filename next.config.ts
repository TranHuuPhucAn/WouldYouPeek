import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disposable verification copies must trace only their own installed project.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
