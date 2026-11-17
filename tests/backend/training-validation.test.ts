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
