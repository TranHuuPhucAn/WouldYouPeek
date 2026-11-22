import { describe, expect, it } from "vitest";
import {
  parseReportCommand,
  parseReportQuery,
  parseResolutionCommand,
  parseVisibilityCommand,
} from "@/server/moderation/validation";
import { parsePlaybackContext } from "@/server/video/validation";
import { requestId, sessionId, snapshot } from "./helpers/session";
const target = {
  kind: "publication",
  scenarioId: "bind-clove-utility-window",
  contentVersion: "vod-1",
};
const report = { requestId, target, category: "broken_video", detail: "" };
describe("moderation input boundaries", () => {
  it("accepts only exact public-version or owned-session target fields", () => {
    expect(parseReportCommand(report)).toEqual(report);
    expect(
      parseReportCommand({
        ...report,
        target: {
          kind: "session-item",
          sessionId,
          itemId: snapshot().items[0].id,
        },
      }).target.kind,
    ).toBe("session-item");
    for (const patch of [
      { target: { ...target, ownerId: requestId } },
      { target: { ...target, contentVersion: "../vod" } },
      { target: { kind: "session-item", sessionId, itemId: "future" } },
      { reporterId: requestId },
      { category: "spam" },
      { detail: null },
    ])
      expect(() => parseReportCommand({ ...report, ...patch })).toThrow();
  });
  it("keeps plain text, trims edges and bounds Unicode characters consistently", () => {
    expect(
      parseReportCommand({ ...report, detail: " <b>plain</b> " }).detail,
    ).toBe("<b>plain</b>");
    expect(
      parseReportCommand({ ...report, detail: "🎮".repeat(2000) }).detail,
    ).toHaveLength(4000);
    for (const detail of ["🎮".repeat(2001), "bad\u0000text"])
      expect(() => parseReportCommand({ ...report, detail })).toThrow();
    expect(() =>
      parseReportCommand({ ...report, category: "other", detail: " \n " }),
    ).toThrow();
  });
  it("binds bounded opaque queue cursors to their status", () => {
    const cursor = Buffer.from(
      JSON.stringify({
        status: "resolved",
        at: "2026-11-22T12:00:00Z",
        id: requestId,
      }),
    ).toString("base64url");
    expect(
      parseReportQuery({ status: "resolved", cursor, limit: "50" }),
    ).toEqual({ status: "resolved", cursor, limit: 50 });
    for (const query of [
      { cursor },
      { limit: "51" },
      { limit: "1.0" },
      { status: "all" },
      { cursor: "bad=" },
      { reporterId: requestId },
    ])
      expect(() => parseReportQuery(query)).toThrow();
  });
  it("requires explicit resolution and visibility reason without privilege fields", () => {
    const resolution = {
      requestId,
      expectedRevision: 0,
      resolution: "addressed",
      operatorNote: " Checked ",
    };
    expect(parseResolutionCommand(resolution).operatorNote).toBe("Checked");
    expect(() =>
      parseResolutionCommand({ ...resolution, operatorNote: "" }),
    ).toThrow();
    expect(() =>
      parseResolutionCommand({ ...resolution, resolution: "open" }),
    ).toThrow();
    const visibility = {
      requestId,
      expectedRevision: 0,
      hidden: true,
      reason: " Broken ",
    };
    expect(parseVisibilityCommand(visibility).reason).toBe("Broken");
    for (const patch of [
      { hidden: "true" },
      { expectedRevision: -1 },
      { reason: "x".repeat(1001) },
      { role: "operator" },
    ])
      expect(() =>
        parseVisibilityCommand({ ...visibility, ...patch }),
      ).toThrow();
  });
  it("accepts an operator report context without caller-controlled media identity", () => {
    expect(
      parsePlaybackContext({
        kind: "operator-report",
        reportId: requestId,
        phase: "reveal",
      }),
    ).toEqual({
      kind: "operator-report",
      reportId: requestId,
      phase: "reveal",
    });
    for (const patch of [
      { assetId: sessionId },
      { phase: "decision" },
      { reportId: "missing" },
    ])
      expect(() =>
        parsePlaybackContext({
          kind: "operator-report",
          reportId: requestId,
          phase: "setup",
          ...patch,
        }),
      ).toThrow();
  });
});
