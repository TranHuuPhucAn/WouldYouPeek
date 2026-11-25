import { describe, it, expect } from "vitest";
import {
  parseStartSession,
  parseAnswerCommand,
  parseAdvanceCommand,
  parseHistoryCursor,
} from "@/server/training/validation";
const uuid = "11111111-1111-4111-8111-111111111111";
describe("session command input", () => {
  it("accepts only intended command fields", () => {
    expect(parseStartSession({ requestId: uuid })).toEqual({ requestId: uuid });
    expect(
      parseAnswerCommand({
        optionId: "hold-exit",
        requestId: uuid,
        expectedRevision: 0,
      }),
    ).toMatchObject({ optionId: "hold-exit" });
    expect(
      parseAdvanceCommand({
        fromItemId: uuid,
        requestId: uuid,
        expectedRevision: 1,
      }),
    ).toMatchObject({ fromItemId: uuid });
  });
  it("distinguishes legacy demo starts from explicit selected targets", () => {
    expect(
      parseStartSession({ requestId: uuid, target: { kind: "demo" } }),
    ).toEqual({ requestId: uuid, target: { kind: "demo" } });
    expect(
      parseStartSession({
        requestId: uuid,
        target: {
          kind: "scenario",
          scenarioId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        },
      }),
    ).toEqual({
      requestId: uuid,
      target: {
        kind: "scenario",
        scenarioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
  });
  it("accepts curated scenario slugs only in the scenario target", () => {
    const target = {
      kind: "scenario",
      scenarioId: "bind-clove-utility-window",
    };
    expect(parseStartSession({ requestId: uuid, target })).toEqual({
      requestId: uuid,
      target,
    });
    expect(() =>
      parseStartSession({ requestId: "bind-clove-utility-window", target }),
    ).toThrow();
    expect(() =>
      parseAdvanceCommand({
        requestId: uuid,
        fromItemId: target.scenarioId,
        expectedRevision: 1,
      }),
    ).toThrow();
  });
  it.each([
    null,
    { kind: "demo", scenarioId: uuid },
    { kind: "scenario" },
    { kind: "scenario", scenarioId: "../legacy-demo-slug" },
    { kind: "scenario", scenarioId: uuid, ownerId: uuid },
    { kind: "playlist" },
  ])("rejects malformed selected target %j", (target) =>
    expect(() => parseStartSession({ requestId: uuid, target })).toThrow(),
  );
  it.each([
    {},
    null,
    [],
    { requestId: "bad" },
    { requestId: uuid, userId: uuid },
  ])("rejects start %j", (input) =>
    expect(() => parseStartSession(input)).toThrow(),
  );
  it.each([-1, 1.5, "0", null, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1])(
    "rejects revision %j",
    (expectedRevision) =>
      expect(() =>
        parseAnswerCommand({
          optionId: "hold-exit",
          requestId: uuid,
          expectedRevision,
        }),
      ).toThrow(),
  );
  it("rejects forged assessments, whitespace options and cursors", () => {
    expect(() =>
      parseAnswerCommand({
        optionId: "hold-exit",
        requestId: uuid,
        expectedRevision: 0,
        selectedAssessment: "recommended",
      }),
    ).toThrow();
    expect(() =>
      parseAnswerCommand({
        optionId: " hold",
        requestId: uuid,
        expectedRevision: 0,
      }),
    ).toThrow();
    expect(() => parseHistoryCursor("bad")).toThrow();
    expect(parseHistoryCursor()).toBeNull();
    expect(parseHistoryCursor(uuid)).toBe(uuid);
  });
});
