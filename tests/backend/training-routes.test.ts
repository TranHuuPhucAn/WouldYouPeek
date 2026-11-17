import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  getHistory: vi.fn(),
  startSession: vi.fn(),
  getSession: vi.fn(),
  answerSessionItem: vi.fn(),
  advanceSession: vi.fn(),
  getAccount: vi.fn(),
  enableCreator: vi.fn(),
}));
vi.mock("@/server/training/service", () => mocks);
vi.mock("@/server/account/service", () => mocks);
import { GET as history, POST as start } from "@/app/api/sessions/route";
import { GET as get } from "@/app/api/sessions/[sessionId]/route";
import { POST as answer } from "@/app/api/sessions/[sessionId]/items/[itemId]/answer/route";
import { POST as advance } from "@/app/api/sessions/[sessionId]/advance/route";
import { GET as account } from "@/app/api/account/route";
import { POST as creator } from "@/app/api/account/creator/route";
import { ApiError } from "@/server/http";
const origin = "http://127.0.0.1:3000";
function request(body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request(origin + "/api/sessions", {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  Object.values(mocks).forEach((mock) =>
    mock.mockReset().mockResolvedValue({ ok: true }),
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("authenticated session HTTP adapters", () => {
  it("forwards command bodies and awaited identifiers", async () => {
    expect((await start(request({ requestId: "r" }))).status).toBe(200);
    expect(mocks.startSession).toHaveBeenCalledWith({ requestId: "r" });
    await answer(request({ optionId: "hold" }), {
      params: Promise.resolve({ sessionId: "s", itemId: "i" }),
    });
    expect(mocks.answerSessionItem).toHaveBeenCalledWith("s", "i", {
      optionId: "hold",
    });
    await advance(request({ fromItemId: "i" }), {
      params: Promise.resolve({ sessionId: "s" }),
    });
    expect(mocks.advanceSession).toHaveBeenCalledWith("s", { fromItemId: "i" });
  });
  it("reads owned session/history/account through guarded services", async () => {
    await get(new Request(origin), {
      params: Promise.resolve({ sessionId: "s" }),
    });
    expect(mocks.getSession).toHaveBeenCalledWith("s");
    await history(new Request(origin + "/api/sessions?cursor=cursor"));
    expect(mocks.getHistory).toHaveBeenCalledWith("cursor");
    await account();
    expect(mocks.getAccount).toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 503])(
    "preserves status%d without leaking unknown details",
    async (status) => {
      const code = (
        {
          401: "AUTH_REQUIRED",
          403: "EMAIL_NOT_VERIFIED",
          404: "SESSION_NOT_FOUND",
          409: "SESSION_CONFLICT",
          503: "STORAGE_UNAVAILABLE",
        } as const
      )[status as 401];
      mocks.startSession.mockRejectedValue(new ApiError(code, "Safe message"));
      const response = await start(request());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    },
  );
  it("rejects malformed JSON before service", async () => {
    expect((await start(request("{"))).status).toBe(400);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it.each([
    { origin: "https://evil.example" },
    { origin: "null" },
    { "content-type": "text/plain" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects unsafe mutation request %j", async (headers) => {
    expect(
      (await start(request({}, headers as unknown as Record<string, string>)))
        .status,
    ).toBe(400);
    expect(mocks.startSession).not.toHaveBeenCalled();
  });
  it("requires explicit same-origin header", async () => {
    const req = request();
    req.headers.delete("origin");
    expect((await start(req)).status).toBe(400);
  });
  it("enables creator with no caller-controlled role/user", async () => {
    expect((await creator(request({}))).status).toBe(200);
    expect(mocks.enableCreator).toHaveBeenCalledWith();
    for (const body of [{ userId: "other" }, { role: "creator" }, [], null])
      expect((await creator(request(body))).status).toBe(400);
    expect(mocks.enableCreator).toHaveBeenCalledTimes(1);
  });
});
