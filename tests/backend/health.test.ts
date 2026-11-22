import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const capabilities = vi.hoisted(() => vi.fn());
vi.mock("@/server/deployment/capabilities", () => ({
  getDeploymentCapabilities: capabilities,
}));
import { GET } from "@/app/api/health/route";
beforeEach(() => {
  capabilities.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("minimal readiness", () => {
  it("reports ready without publishing environment or provider settings", async () => {
    capabilities.mockResolvedValue({ sourceMode: "youtube-only" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("sanitizes failed readiness and supplies an opaque request id", async () => {
    capabilities.mockRejectedValue(new Error("postgres://private-secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false });
    expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("private-secret"),
    );
  });
});
