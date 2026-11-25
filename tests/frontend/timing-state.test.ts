import { describe, expect, it } from "vitest";
import { formatTimestampInput } from "@/lib/creator/timestamps";
import {
  applyMarkedTime,
  applyTypedTime,
  applyTimingValues,
  createTimingState,
  timingInputIssues,
} from "@/lib/creator/timing-state";
const media = {
  startSeconds: 10,
  decisionSeconds: 20,
  endSeconds: 30,
  setupAlt: "Setup",
  decisionAlt: "Pause",
  revealAlt: "Reveal",
};
describe("manual timing state", () => {
  it("shares marked and typed timestamps without discarding invalid input", () => {
    const initial = createTimingState(media);
    const invalid = applyTypedTime(initial, "decisionSeconds", "not a time");
    expect(invalid.decisionSeconds).toBe("not a time");
    expect(applyTimingValues(invalid, media).decisionSeconds).toBe(20);
    expect(timingInputIssues(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "media.decisionSeconds" }),
      ]),
    );
    const marked = applyMarkedTime(invalid, "decisionSeconds", 22.1254);
    expect(applyTimingValues(marked, media).decisionSeconds).toBe(22.125);
    expect(timingInputIssues(marked)).toEqual([]);
  });
  it("rejects nonfinite marks and reports upload duration overflow", () => {
    const initial = createTimingState(media);
    expect(applyMarkedTime(initial, "startSeconds", NaN)).toEqual(initial);
    expect(applyMarkedTime(initial, "startSeconds", -1)).toEqual(initial);
    expect(timingInputIssues(initial, 25)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "media.endSeconds" }),
      ]),
    );
    expect(timingInputIssues(initial, null)).toEqual([]);
  });
});

it("carries rounded milliseconds across second and minute boundaries", () => {
  expect(formatTimestampInput(12.9996)).toBe("0:13");
  expect(formatTimestampInput(59.9996)).toBe("1:00");
});
