import { describe, expect, it } from "vitest";
import { safeErrorDetails } from "@/server/http";
import { sessionId } from "./helpers/session";
const activeSession = {
  id: sessionId,
  status: "in_progress",
  title: "Curated scenario",
  answeredCount: 0,
  totalCount: 1,
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-20T00:00:00Z",
  completedAt: null,
  endedAt: null,
  target: { kind: "scenario", scenarioId: "bind-clove-utility-window" },
};
describe("curated active-session conflict summaries", () => {
  it("preserves the starter slug but strips all extra session and target fields", () => {
    expect(
      safeErrorDetails("ACTIVE_SESSION_EXISTS", {
        activeSession: {
          ...activeSession,
          answers: "private",
          target: { ...activeSession.target, secret: true },
        },
        diagnostic: "private",
      }),
    ).toEqual({ activeSession });
  });
  it.each([
    { id: "bind-clove-utility-window" },
    { target: { kind: "scenario", scenarioId: "../invalid" } },
    { status: "completed" },
    { totalCount: 0 },
  ])(
    "does not broaden unrelated identifiers or invalid summaries",
    (change) => {
      expect(
        safeErrorDetails("ACTIVE_SESSION_EXISTS", {
          activeSession: { ...activeSession, ...change },
        }),
      ).toBeUndefined();
    },
  );
});
