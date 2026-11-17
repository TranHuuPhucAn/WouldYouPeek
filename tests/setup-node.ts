import { vi } from "vitest";

// The Next.js build enforces this boundary. Vitest runs outside its React resolver.
vi.mock("server-only", () => ({}));
