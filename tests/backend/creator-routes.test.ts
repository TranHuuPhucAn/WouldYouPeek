import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createDraft: vi.fn(),
  listOwnedScenarios: vi.fn(),
  findOwnedScenario: vi.fn(),
  saveDraft: vi.fn(),
  getReviewPreview: vi.fn(),
  recordReview: vi.fn(),
  publishScenario: vi.fn(),
  unpublishScenario: vi.fn(),
}));
vi.mock("@/server/creator/service", () => mocks);
import * as collection from "@/app/api/creator/scenarios/route";
import * as item from "@/app/api/creator/scenarios/[id]/route";
import * as review from "@/app/api/creator/scenarios/[id]/review/route";
import { POST as publish } from "@/app/api/creator/scenarios/[id]/publish/route";
import { POST as unpublish } from "@/app/api/creator/scenarios/[id]/unpublish/route";
import {
  ApiError,
  readLimitedJsonBody,
  safeErrorDetails,
  errorResponse,
} from "@/server/http";
import { creatorScenarioId, creatorSnapshot } from "./helpers/creator";
import { requestId, snapshot } from "./helpers/session";
const origin = "http://127.0.0.1:3000";
const context = { params: Promise.resolve({ id: creatorScenarioId }) };
function request(
  body: unknown = { requestId },
  method = "POST",
  from = origin,
) {
  return new Request(`${origin}/api/creator/scenarios`, {
    method,
    headers: { origin: from, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  Object.values(mocks).forEach((m) =>
    m
      .mockReset()
      .mockResolvedValue({
        scenario: creatorSnapshot(),
        replayed: false,
        publishedVersion: null,
      }),
  );
});
describe("creator routes and safe HTTP boundaries", () => {
  it("uses the intended service for all write methods", async () => {
    for (const [handler, name] of [
      [collection.POST, "createDraft"],
      [item.PUT, "saveDraft"],
      [review.POST, "recordReview"],
      [publish, "publishScenario"],
      [unpublish, "unpublishScenario"],
    ] as const) {
      const response = await handler(request(), context);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks[name]).toHaveBeenCalled();
    }
  });
  it("requires same origin before mutations and bounds actual UTF8 bytes", async () => {
    expect(
      (await collection.POST(request({}, "POST", "https://elsewhere.example")))
        .status,
    ).toBe(400);
    expect(mocks.createDraft).not.toHaveBeenCalled();
    const large = request({ text: "🎯".repeat(20_000) });
    expect((await collection.POST(large)).status).toBe(413);
    const lying = new Request(`${origin}/api`, {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: JSON.stringify({ value: "a".repeat(100) }),
    });
    await expect(readLimitedJsonBody(lying, 20)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    await expect(
      readLimitedJsonBody(
        new Request(`${origin}/api`, { method: "POST", body: "{" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_JSON" });
  });
  it("rejects unsupported query keys and passes resource revision", async () => {
    expect(
      (await collection.GET(new Request(`${origin}/api?ownerId=other`))).status,
    ).toBe(400);
    expect(
      (
        await collection.GET(
          new Request(`${origin}/api?status=all&status=published`),
        )
      ).status,
    ).toBe(400);
    await collection.GET(new Request(`${origin}/api?status=published`));
    expect(mocks.listOwnedScenarios).toHaveBeenCalledWith(null, "published");
    await item.GET(new Request(origin), context);
    expect(mocks.findOwnedScenario).toHaveBeenCalledWith(creatorScenarioId);
    await review.GET(new Request(`${origin}/api?revision=3`), context);
    expect(mocks.getReviewPreview).toHaveBeenCalledWith(creatorScenarioId, "3");
  });
  it("exposes only code-matched safe error details", async () => {
    const active = snapshot();
    const summary = {
      ...active,
      answeredCount: 0,
      totalCount: 3,
      email: "private@example.test",
    };
    const details = safeErrorDetails("ACTIVE_SESSION_EXISTS", {
      activeSession: summary,
    });
    expect(details).toMatchObject({
      activeSession: { id: active.id, target: { kind: "demo" } },
    });
    expect(JSON.stringify(details)).not.toContain("email");
    expect(JSON.stringify(details)).not.toContain("items");
    expect(
      safeErrorDetails("INTERNAL_ERROR", { activeSession: summary }),
    ).toBeUndefined();
    expect(
      safeErrorDetails("DRAFT_NOT_READY", {
        issues: [
          {
            path: "title",
            code: "REQUIRED",
            message: "Add a title",
            secret: true,
          },
        ],
      }),
    ).toEqual({
      issues: [{ path: "title", code: "REQUIRED", message: "Add a title" }],
    });
    mocks.createDraft.mockRejectedValue(
      new ApiError("DRAFT_NOT_READY", "Complete fields.", {
        issues: [{ path: "title", code: "REQUIRED", message: "Add a title" }],
      }),
    );
    const response = await collection.POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toHaveProperty("error.details.issues");
    expect(
      await errorResponse(new Error("password=secret")).text(),
    ).not.toContain("secret");
  });
});
