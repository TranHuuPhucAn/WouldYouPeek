import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/server/auth/guards", () => ({ requireVerifiedUser: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ rpc: mocks.rpc }),
}));
import { enableCreator, getAccount } from "@/server/account/service";
beforeEach(() => {
  mocks.guard
    .mockReset()
    .mockResolvedValue({ role: "creator", capabilities: ["learn", "create"] });
  mocks.rpc
    .mockReset()
    .mockResolvedValue({ data: { role: "creator" }, error: null });
});
describe("account service", () => {
  it("re-reads current trusted profile after self-enrollment", async () => {
    expect(await enableCreator()).toMatchObject({
      role: "creator",
      capabilities: ["learn", "create"],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("enable_creator");
    expect(mocks.guard).toHaveBeenCalledTimes(2);
  });
  it("requires identity before invoking mutation", async () => {
    mocks.guard.mockRejectedValue(new Error("denied"));
    await expect(enableCreator()).rejects.toThrow("denied");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps unavailable storage without returning optimistic role", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "private db error" } });
    await expect(enableCreator()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("gets only the current account", async () =>
    expect(await getAccount()).toMatchObject({ role: "creator" }));
});
