import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionRecap } from "@/components/challenge/SessionRecap";
import { AnalysisNote } from "@/components/challenge/AnalysisNote";
import {
  parseSessionSnapshot,
  parseSessionSummary,
  validateSessionContinuity,
  createOrResumeSession,
} from "@/lib/client/session-api";
import { creatorId, commandId, selectedSnapshot } from "./creator-fixtures";
describe("one-scenario session contracts and presentation", () => {
  it.each(["setup", "review", "completed"] as const)(
    "accepts an internally consistent one-scenario %s",
    (phase) =>
      expect(parseSessionSnapshot(selectedSnapshot(phase))).toEqual(
        selectedSnapshot(phase),
      ),
  );
  it("rejects a changed target, wrong scenario or silently resumed demo", async () => {
    const s = selectedSnapshot();
    expect(() =>
      parseSessionSnapshot({
        ...s,
        target: { kind: "scenario", scenarioId: commandId },
      }),
    ).toThrow();
    expect(() =>
      validateSessionContinuity({ ...s, target: { kind: "demo" } }, s),
    ).toThrow();
    expect(() =>
      parseSessionSummary({
        ...s,
        items: undefined,
        answeredCount: 0,
        totalCount: 3,
      }),
    ).toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          session: { ...s, target: { kind: "demo" } },
          created: false,
          replayed: false,
        }),
      ),
    );
    await expect(
      createOrResumeSession({
        requestId: commandId,
        target: { kind: "scenario", scenarioId: creatorId },
      }),
    ).rejects.toThrow();
  });
  it("uses the saved scenario title and one-call recap, with library navigation", () => {
    const s = selectedSnapshot("completed");
    render(
      <SessionRecap
        items={s.items}
        sessionId={s.id}
        viewerId="test-viewer"
        onRestart={vi.fn()}
        title={s.title}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "One call.More perspective.",
    );
    expect(screen.queryByText("Three calls.")).not.toBeInTheDocument();
    expect(screen.getAllByText(s.title).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /library/i })).toHaveAttribute(
      "href",
      "/library",
    );
  });
  it.each([
    ["creator", "Creator analysis"],
    ["ai-assisted", "Creator analysis · AI-assisted"],
    ["ai", "AI analysis"],
  ] as const)("truthfully labels %s provenance", (author, label) => {
    render(
      <AnalysisNote
        analysis={{
          author,
          notice: "Interpretation only",
          rationale: "Observed cues support conditional choices.",
          limitations: [],
        }}
      />,
    );
    expect(screen.getByRole("region", { name: label })).toBeInTheDocument();
    expect(screen.getByText("Interpretation only")).toBeInTheDocument();
  });
});
