import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
type Cookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};
type Adapter = {
  cookies: {
    getAll: () => Cookie[];
    setAll: (cookies: Cookie[], headers: Record<string, string>) => void;
  };
  global?: { fetch: typeof fetch };
};
const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  claims: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.factory }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: mocks.cookieGet, set: mocks.cookieSet }),
}));
vi.mock("@/server/config", () => ({
  getPublicSupabaseConfig: () => ({
    url: "http://127.0.0.1:54321",
    publishableKey: "public",
  }),
}));
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { refreshAuthSession } from "@/lib/supabase/proxy";
beforeEach(() => {
  mocks.factory
    .mockReset()
    .mockImplementation(() => ({ auth: { getClaims: mocks.claims } }));
  mocks.cookieGet.mockReset().mockReturnValue([
    { name: "auth.0", value: "one" },
    { name: "auth.1", value: "two" },
  ]);
  mocks.cookieSet.mockReset();
  mocks.claims.mockReset().mockResolvedValue({ data: null });
});
describe("request scoped Supabase SSR adapters", () => {
  it("uses fresh public-key clients and forwards cookie chunks", async () => {
    const headers = new Headers();
    await createServerSupabaseClient(headers);
    await createServerSupabaseClient();
    expect(mocks.factory).toHaveBeenCalledTimes(2);
    expect(mocks.factory.mock.calls[0].slice(0, 2)).toEqual([
      "http://127.0.0.1:54321",
      "public",
    ]);
    const options = mocks.factory.mock.calls[0][2] as Adapter;
    expect(options.cookies.getAll()).toHaveLength(2);
    options.cookies.setAll(
      [
        { name: "auth.0", value: "fresh", options: { path: "/" } },
        { name: "auth.1", value: "", options: { maxAge: 0 } },
      ],
      { "Cache-Control": "private, no-cache, no-store", Expires: "0" },
    );
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    expect(headers.get("expires")).toBe("0");
  });
  it("supports read-only server rendering while proxy owns refresh", async () => {
    mocks.cookieSet.mockImplementation(() => {
      throw new Error("readonly");
    });
    await createServerSupabaseClient();
    const options = mocks.factory.mock.calls[0][2] as Adapter;
    expect(() =>
      options.cookies.setAll([{ name: "auth", value: "value" }], {}),
    ).not.toThrow();
  });
  it("redirects guest protected pages but retains refreshed cookies and provider cache headers", async () => {
    mocks.claims.mockImplementation(async () => {
      const options = mocks.factory.mock.calls[0][2] as Adapter;
      options.cookies.setAll(
        [{ name: "auth", value: "new", options: { path: "/" } }],
        {
          "Cache-Control":
            "private, no-cache, no-store, must-revalidate, max-age=0",
          Expires: "0",
          Pragma: "no-cache",
        },
      );
      return { data: null };
    });
    const request = new NextRequest("http://127.0.0.1:3000/play/session");
    const response = await refreshAuthSession(request);
    expect(response.headers.get("location")).toContain("/sign-in?returnTo=");
    expect(response.cookies.get("auth")?.value).toBe("new");
    expect(request.cookies.get("auth")?.value).toBe("new");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    expect(response.headers.get("expires")).toBe("0");
  });
  it("allows public previews and signed-in protected pages", async () => {
    expect(
      (
        await refreshAuthSession(new NextRequest("http://localhost/demo"))
      ).headers.get("location"),
    ).toBeNull();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: "u" } } });
    expect(
      (
        await refreshAuthSession(new NextRequest("http://localhost/play"))
      ).headers.get("location"),
    ).toBeNull();
  });
});
