import { describe, expect, it } from "vitest";
import {
  ApiError,
  errorResponse,
  handleRoute,
  jsonResponse,
  readJsonBody,
} from "@/server/http";

describe("HTTP response helpers", () => {
  it("serializes a JSON body with explicit status and no-store caching", async () => {
    const response = jsonResponse({ ok: true }, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each([
    ["INVALID_JSON", 400],
    ["INVALID_REQUEST", 400],
    ["INVALID_OPTION", 400],
    ["CHALLENGE_NOT_FOUND", 404],
  ] as const)("maps %s to %i", async (code, status) => {
    const response = errorResponse(new ApiError(code, "Public error"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "Public error" },
    });
  });

  it.each([
    new Error("private connection detail"),
    new ApiError("INTERNAL_ERROR", "private internal detail"),
    "secret",
  ])("hides unexpected error details", async (error) => {
    const response = errorResponse(error);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      },
    });
  });

  it("reads valid JSON as unknown data", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: '{"optionId":"hold"}',
    });
    expect(await readJsonBody(request)).toEqual({ optionId: "hold" });
  });

  it("converts malformed JSON to a controlled error", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "{",
    });
    await expect(readJsonBody(request)).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
  });

  it("wraps both synchronous and asynchronous successful operations", async () => {
    expect(await (await handleRoute(() => ({ value: 1 }))).json()).toEqual({
      value: 1,
    });
    expect(
      await (await handleRoute(async () => ({ value: 2 }))).json(),
    ).toEqual({ value: 2 });
  });

  it("catches rejected operations at the route boundary", async () => {
    const response = await handleRoute(async () => {
      throw new Error("sensitive detail");
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive detail");
  });
});
