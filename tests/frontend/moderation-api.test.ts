import { describe, expect, it, vi } from "vitest";
import {
  parseReportReceipt,
  parseOperatorDetail,
  parseVisibility,
  submitScenarioReport,
  resolveReport,
  setScenarioVisibility,
} from "@/lib/client/moderation-api";
import { operatorDetail, receipt, reportId } from "./moderation-fixtures";
import { commandId, when } from "./creator-fixtures";
describe("moderation client boundaries", () => {
  it("keeps receipts small and validates real pinned media without a fabricated answer", () => {
    expect(parseReportReceipt(receipt())).toEqual(receipt());
    expect(parseOperatorDetail(operatorDetail(), reportId)).toEqual(
      operatorDetail(),
    );
    expect(() =>
      parseReportReceipt({ ...receipt(), reporterId: commandId }),
    ).toThrow();
    expect(() =>
      parseOperatorDetail({
        ...operatorDetail(),
        media: { ...operatorDetail().media, selectedOptionId: "peek" },
      }),
    ).toThrow();
    const changed = operatorDetail();
    changed.media.challenge.contentVersion = "different";
    expect(() => parseOperatorDetail(changed)).toThrow();
  });
  it("rejects wrong report IDs and invalid restored visibility", () => {
    expect(() => parseOperatorDetail(operatorDetail(), commandId)).toThrow();
    expect(() =>
      parseVisibility({ ...operatorDetail().visibility, hidden: true }),
    ).toThrow();
    expect(() =>
      parseVisibility({
        ...operatorDetail().visibility,
        revision: 2,
        reason: null,
        changedAt: when,
      }),
    ).toThrow();
  });
  it("sends exact idempotent report commands privately and retains duplicate receipts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json(receipt({ duplicate: true })));
    vi.stubGlobal("fetch", fetcher);
    const command = {
      requestId: commandId,
      target: {
        kind: "publication" as const,
        scenarioId: "bind-clove-smoke-contest",
        contentVersion: "v1",
      },
      category: "broken_video" as const,
      detail: "Cannot play",
    };
    expect((await submitScenarioReport(command)).duplicate).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/scenario-reports",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify(command),
      }),
    );
  });
  it("rejects empty Other and too-long reports before a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const input = {
      requestId: commandId,
      target: {
        kind: "publication" as const,
        scenarioId: "bind-clove-smoke-contest",
        contentVersion: "v1",
      },
      category: "other" as const,
      detail: "",
    };
    await expect(submitScenarioReport(input)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(
      submitScenarioReport({ ...input, detail: "x".repeat(2001) }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not accept another report or scenario's mutation response", async () => {
    const detail = operatorDetail();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            report: { ...detail.report, id: commandId },
            replayed: false,
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            visibility: {
              ...detail.visibility,
              scenarioId: "unrelated-scenario",
            },
            replayed: false,
          }),
        ),
    );
    await expect(
      resolveReport(reportId, {
        requestId: commandId,
        expectedRevision: 0,
        resolution: "addressed",
        operatorNote: "Checked",
      }),
    ).rejects.toThrow();
    await expect(
      setScenarioVisibility(detail.report.scenarioId, {
        requestId: commandId,
        expectedRevision: 0,
        hidden: true,
        reason: "Unavailable",
      }),
    ).rejects.toThrow();
  });
});
it("rejects impossible operator revisions, empty Other reports, malformed versions and media cross-wiring", () => {
  for (const report of [
    { ...operatorDetail().report, revision: 2 },
    { ...operatorDetail().report, category: "other", detail: "" },
    { ...operatorDetail().report, contentVersion: "version / bad" },
  ])
    expect(() =>
      parseOperatorDetail({ ...operatorDetail(), report }),
    ).toThrow();
  const detail = operatorDetail();
  const reveal = detail.media.reveal;
  if (reveal.kind !== "youtube") throw new Error("Expected YouTube");
  expect(() =>
    parseOperatorDetail({
      ...detail,
      media: {
        ...detail.media,
        reveal: {
          ...reveal,
          startSeconds: reveal.startSeconds + 1,
        },
      },
    }),
  ).toThrow();
  expect(() =>
    parseOperatorDetail({
      ...detail,
      media: {
        ...detail.media,
        reveal: { ...reveal, videoId: "abcdefghijk" },
      },
    }),
  ).toThrow();
});
