import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  rpc: vi.fn(),
  result: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getServerAppConfig: mocks.config }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
import {
  getDeploymentCapabilities,
  requireUploadsEnabled,
} from "@/server/deployment/capabilities";
beforeEach(() => {
  mocks.config.mockReturnValue({ deploymentMode: "local" });
  mocks.rpc.mockReset().mockReturnValue({ abortSignal: mocks.result });
  mocks.result.mockReset().mockResolvedValue({
    data: { sourceMode: "youtube-and-upload" },
    error: null,
  });
});
describe("database-backed deployment capability", () => {
  it("reads the narrow RPC and allows explicit local uploads", async () => {
    await expect(requireUploadsEnabled()).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith("get_application_capabilities");
    expect(mocks.result).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("denies upload mode in hosted config", async () => {
    mocks.config.mockReturnValue({ deploymentMode: "hosted" });
    await expect(getDeploymentCapabilities()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("accepts YouTube-only and denies upload service admission", async () => {
    mocks.result.mockResolvedValue({
      data: { sourceMode: "youtube-only" },
      error: null,
    });
    await expect(getDeploymentCapabilities()).resolves.toEqual({
      sourceMode: "youtube-only",
    });
    await expect(requireUploadsEnabled()).rejects.toMatchObject({
      code: "UPLOADS_DISABLED",
    });
  });
  it.each([
    null,
    [],
    {},
    { sourceMode: "all" },
    { sourceMode: "youtube-only", secret: "private" },
  ])("rejects malformed capability %j", async (data) => {
    mocks.result.mockResolvedValue({ data, error: null });
    await expect(getDeploymentCapabilities()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("never falls back to uploads on database error", async () => {
    mocks.result.mockResolvedValue({
      data: null,
      error: { message: "private details" },
    });
    await expect(getDeploymentCapabilities()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("maps a rejected or timed-out capability lookup to safe unavailability", async () => {
    mocks.result.mockRejectedValue(new Error("private database details"));
    await expect(getDeploymentCapabilities()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message:
        "The application is temporarily unavailable. Please try again later.",
    });
  });
});
