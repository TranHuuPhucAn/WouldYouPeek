import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http";
const m = vi.hoisted(() => ({
  submitReport: vi.fn(),
  getOperatorReports: vi.fn(),
  getOperatorReport: vi.fn(),
  resolveOperatorReport: vi.fn(),
  changeScenarioVisibility: vi.fn(),
}));
vi.mock("@/server/moderation/service", () => m);
import { POST as report } from "@/app/api/scenario-reports/route";
import { GET as list } from "@/app/api/operator/reports/route";
import { GET as detail } from "@/app/api/operator/reports/[id]/route";
import { POST as resolve } from "@/app/api/operator/reports/[id]/resolve/route";
import { POST as visibility } from "@/app/api/operator/scenarios/[id]/visibility/route";
const origin = "http://127.0.0.1:3000",
  ctx = { params: Promise.resolve({ id: "target" }) };
const post = (body: unknown, from = origin, path = "/api/scenario-reports") =>
  new Request(origin + path, {
    method: "POST",
    headers: { origin: from, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  Object.values(m).forEach((f) =>
    f.mockReset().mockResolvedValue({ ok: true }),
  );
});
describe("private moderation route boundaries", () => {
  it("rejects foreign origins, oversized bodies and unsupported selectors before services", async () => {
    for (const route of [report, resolve, visibility])
      expect((await route(post({}, "https://foreign.test"), ctx)).status).toBe(
        400,
      );
    expect((await report(post({ detail: "x".repeat(17000) }))).status).toBe(
      413,
    );
    expect(
      (await visibility(post({ reason: "x".repeat(9000) }), ctx)).status,
    ).toBe(413);
    expect(
      (await report(post({}, origin, "/api/scenario-reports?userId=other")))
        .status,
    ).toBe(400);
    expect(
      (
        await list(
          new Request(
            origin + "/api/operator/reports?status=open&status=resolved",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await detail(
          new Request(origin + "/api/operator/reports/id?includeReporter=true"),
          ctx,
        )
      ).status,
    ).toBe(400);
    Object.values(m).forEach((f) => expect(f).not.toHaveBeenCalled());
  });
  it("keeps receipt/detail/operator responses private and forwards only supported fields", async () => {
    for (const response of [
      await report(post({ category: "spoiler" })),
      await list(
        new Request(origin + "/api/operator/reports?status=resolved&limit=20"),
      ),
      await detail(new Request(origin + "/api/operator/reports/id"), ctx),
      await resolve(post({ resolution: "dismissed" }), ctx),
      await visibility(post({ hidden: true }), ctx),
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(m.getOperatorReports).toHaveBeenCalledWith({
      status: "resolved",
      limit: "20",
    });
    expect(m.getOperatorReport).toHaveBeenCalledWith("target");
  });
  it.each([
    ["OPERATOR_REQUIRED", 403],
    ["REPORT_NOT_FOUND", 404],
    ["REPORT_CONFLICT", 409],
    ["REPORT_TARGET_CHANGED", 409],
    ["VISIBILITY_CONFLICT", 409],
    ["RATE_LIMITED", 429],
  ] as const)("maps %s without internal detail", async (code, status) => {
    m.submitReport.mockRejectedValue(new ApiError(code, "Safe message."));
    const response = await report(post({}));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      error: { code, message: "Safe message." },
    });
  });
});
