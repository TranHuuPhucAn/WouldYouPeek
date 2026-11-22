import { describe, expect, it } from "vitest";
import {
  toCreatorVisibilityNotice,
  toOperatorReportDetail,
  toOperatorReportList,
  toOperatorReport,
  toReportReceipt,
  toVisibilityState,
} from "@/server/moderation/projections";
import { reviewSnapshot, requestId } from "./helpers/session";
const item = reviewSnapshot().items[0],
  result = item.answer!.result;
const report = {
  id: requestId,
  scenarioId: item.challenge.id,
  contentVersion: item.challenge.contentVersion,
  category: "analysis_issue",
  detail: "Alternative angle is reasonable.",
  status: "open",
  revision: 0,
  createdAt: "2026-11-22T00:00:00Z",
  resolvedAt: null,
  resolution: null,
  operatorNote: null,
};
const visibility = {
  scenarioId: report.scenarioId,
  hidden: false,
  revision: 0,
  reason: null,
  changedAt: null,
  affectedPlaylistCount: 1,
  affectedEditorialPlaylistCount: 1,
  creatorPublished: true,
  currentContentVersion: report.contentVersion,
};
const media = {
  challenge: item.challenge,
  reveal: result.reveal,
  observedAction: result.observedAction,
  analysis: result.analysis,
  optionFeedback: result.optionFeedback,
  takeaway: result.takeaway,
  outcomeText: result.outcomeText,
};
describe("safe moderation projections", () => {
  it("exposes pinned source analysis without fabricating learner choice or granting playback", () => {
    const detail = toOperatorReportDetail({
      report: { ...report, reporterEmail: "private" },
      media: { ...media, selectedOptionId: "invented", signedUrl: "private" },
      visibility,
    });
    expect(detail.media.challenge.contentVersion).toBe(report.contentVersion);
    expect(detail.media).not.toHaveProperty("selectedOptionId");
    expect(detail.media).not.toHaveProperty("matchesPro");
    expect(detail.media).not.toHaveProperty("signedUrl");
    expect(detail.report).not.toHaveProperty("reporterEmail");
  });
  it("rejects report/version/visibility mismatch and fabricated report transitions", () => {
    for (const patch of [
      { scenarioId: "different-scenario" },
      { contentVersion: "vod-99" },
    ])
      expect(() =>
        toOperatorReportDetail({
          report: { ...report, ...patch },
          media,
          visibility,
        }),
      ).toThrow();
    for (const patch of [
      { revision: 1 },
      { resolvedAt: "2026-11-22T01:00:00Z" },
      { status: "resolved" },
      { operatorNote: "leak" },
    ])
      expect(() => toOperatorReport({ ...report, ...patch })).toThrow();
    expect(
      toOperatorReport({
        ...report,
        status: "resolved",
        revision: 1,
        resolvedAt: "2026-11-22T01:00:00Z",
        resolution: "addressed",
        operatorNote: "Verified source",
      }).resolution,
    ).toBe("addressed");
  });
  it("never passes stale restore reason to creator DTO and validates affected totals", () => {
    expect(
      toCreatorVisibilityNotice({
        hidden: false,
        reason: null,
        changedAt: null,
      }),
    ).toEqual({ hidden: false, reason: null, changedAt: null });
    expect(() =>
      toCreatorVisibilityNotice({
        hidden: false,
        reason: "restore audit",
        changedAt: "2026-11-22T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      toVisibilityState({ ...visibility, affectedPlaylistCount: 0 }),
    ).toThrow();
    expect(() => toVisibilityState({ ...visibility, hidden: true })).toThrow();
  });
  it("projects duplicate/replay receipts without reporter details and rejects duplicate queue IDs", () => {
    expect(
      toReportReceipt({
        report: { ...report, reporterId: requestId },
        duplicate: true,
        replayed: true,
      }),
    ).toEqual({
      report: { id: requestId, status: "open", createdAt: report.createdAt },
      duplicate: true,
      replayed: true,
    });
    expect(() =>
      toOperatorReportList({ reports: [report, report], nextCursor: null }),
    ).toThrow();
  });
  it("rejects media continuity and option-feedback tampering", () => {
    if (media.reveal.kind !== "youtube")
      throw new Error("Expected VOD fixture");
    const reveal = media.reveal;
    expect(() =>
      toOperatorReportDetail({
        report,
        visibility,
        media: {
          ...media,
          reveal: {
            ...reveal,
            startSeconds: reveal.startSeconds + 1,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      toOperatorReportDetail({
        report,
        visibility,
        media: { ...media, optionFeedback: media.optionFeedback?.slice(1) },
      }),
    ).toThrow();
  });
});
