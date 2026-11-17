import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "backend",
          environment: "node",
          include: ["tests/backend/**/*.test.ts"],
          setupFiles: ["./tests/setup-node.ts"],
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        resolve: { alias },
        plugins: [react()],
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.{ts,tsx}"],
          setupFiles: ["./tests/setup-dom.ts"],
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/setup-node.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          clearMocks: true,
          restoreMocks: true,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "http",
          environment: "node",
          include: ["tests/http/**/*.test.ts"],
          setupFiles: ["./tests/setup-node.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
