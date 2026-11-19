import { describe, it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  claims: vi.fn(),
  user: vi.fn(),
  single: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getPublicSupabaseConfig: mock.config }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getClaims: mock.claims, getUser: mock.user },
    from: () => ({ select: () => ({ eq: () => ({ single: mock.single }) }) }),
  }),
}));
import {
  getCurrentAccount,
  requireVerifiedUser,
  requireCreator,
} from "@/server/auth/guards";
beforeEach(() => {
  mock.config.mockReset().mockReturnValue({});
  mock.claims
    .mockReset()
    .mockResolvedValue({ data: { claims: { sub: "u" } }, error: null });
  mock.user
    .mockReset()
    .mockResolvedValue({
      data: {
        user: { id: "u", email: "a@b.com", email_confirmed_at: "2026-01-01" },
      },
      error: null,
    });
  mock.single
    .mockReset()
    .mockResolvedValue({
      data: { role: "learner", created_at: "2026-01-01" },
      error: null,
    });
});
describe("validated account guards", () => {
  it("requires verified claims then a fresh provider user", async () => {
    expect(await getCurrentAccount()).toMatchObject({
      role: "learner",
      capabilities: ["learn"],
      emailVerified: true,
    });
    expect(mock.claims).toHaveBeenCalled();
    expect(mock.user).toHaveBeenCalled();
  });
  it("rejects invalid signed claims without trusting user data", async () => {
    mock.claims.mockResolvedValue({
      error: { status: 401, message: "bad" },
      data: null,
    });
    await expect(requireVerifiedUser()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    expect(mock.user).not.toHaveBeenCalled();
  });
  it.each([0, 500, 503])(
    "reports auth connectivity status%d without replacing viewer withguest",
    async (status) => {
      mock.claims.mockResolvedValue({ error: { status }, data: null });
      await expect(getCurrentAccount()).rejects.toMatchObject({
        code: "STORAGE_UNAVAILABLE",
      });
    },
  );
  it("maps thrown transport failures to serviceunavailable", async () => {
    mock.claims.mockRejectedValue(new TypeError("fetch failed"));
    await expect(getCurrentAccount()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("reports fresh-user provider failure", async () => {
    mock.user.mockResolvedValue({
      error: { status: 503 },
      data: { user: null },
    });
    await expect(getCurrentAccount()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("rejects unverified email", async () => {
    mock.user.mockResolvedValue({
      data: { user: { id: "u", email: "a@b.com" } },
      error: null,
    });
    await expect(requireVerifiedUser()).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
  });
  it("keeps learner access with creator role", async () => {
    mock.single.mockResolvedValue({
      data: { role: "creator", created_at: "2026-01-01" },
      error: null,
    });
    expect(await requireCreator()).toMatchObject({
      capabilities: ["learn", "create"],
    });
  });
  it("does not infer creator from user metadata", async () => {
    mock.user.mockResolvedValue({
      data: {
        user: {
          id: "u",
          email_confirmed_at: "date",
          user_metadata: { role: "creator" },
        },
      },
      error: null,
    });
    await expect(requireCreator()).rejects.toMatchObject({
      code: "CREATOR_REQUIRED",
    });
  });
  it("fails closed on missing profile", async () => {
    mock.single.mockResolvedValue({ data: null, error: new Error("db") });
    await expect(getCurrentAccount()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });
  it("allows unconfigured public rendering only", async () => {
    mock.config.mockImplementation(() => {
      throw new Error("config");
    });
    expect(await getCurrentAccount()).toBeNull();
    await expect(requireVerifiedUser()).rejects.toThrow("config");
  });
});
