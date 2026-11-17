import { describe, expect, it } from "vitest";
import {
  getPlaybackInstruction,
  PAUSE_MARGIN_SECONDS,
  validateSegment,
} from "@/lib/video/segment-controller";

const segment = { startSeconds: 100, endSeconds: 108 };
const state = {
  segment,
  currentTime: 103,
  playing: true,
  finished: false,
  mode: "setup" as const,
};

describe("bounded source playback", () => {
  it.each([
    { startSeconds: -1, endSeconds: 3 },
    { startSeconds: 5, endSeconds: 5 },
    { startSeconds: 5, endSeconds: 4 },
    { startSeconds: Number.NaN, endSeconds: 8 },
    { startSeconds: 0, endSeconds: Infinity },
  ])("rejects unusable bounds %j", (bounds) =>
    expect(validateSegment(bounds)).toBe(false),
  );
  it("accepts finite fractional source boundaries", () =>
    expect(validateSegment({ startSeconds: 1885, endSeconds: 1889.5 })).toBe(
      true,
    ));
  it("pauses before the provider end and completes at most once", () => {
    expect(
      getPlaybackInstruction({
        ...state,
        currentTime: 108 - PAUSE_MARGIN_SECONDS - 0.01,
      }),
    ).toBe("continue");
    expect(
      getPlaybackInstruction({
        ...state,
        currentTime: 108 - PAUSE_MARGIN_SECONDS,
      }),
    ).toBe("complete");
    expect(
      getPlaybackInstruction({ ...state, currentTime: 108, finished: true }),
    ).toBe("pause");
    expect(
      getPlaybackInstruction({
        ...state,
        currentTime: 108,
        finished: true,
        playing: false,
      }),
    ).toBe("continue");
  });
  it("never allows playback during a decision", () => {
    expect(getPlaybackInstruction({ ...state, mode: "decision" })).toBe(
      "pause",
    );
    expect(
      getPlaybackInstruction({ ...state, mode: "decision", playing: false }),
    ).toBe("continue");
  });
  it("resets a seek outside the allowed beginning", () => {
    expect(getPlaybackInstruction({ ...state, currentTime: 95 })).toBe(
      "restart",
    );
    expect(getPlaybackInstruction({ ...state, currentTime: 99.5 })).toBe(
      "continue",
    );
  });
  it("uses the reveal boundary rather than the setup boundary", () => {
    expect(
      getPlaybackInstruction({
        ...state,
        mode: "reveal",
        segment: { startSeconds: 108, endSeconds: 115 },
        currentTime: 110,
      }),
    ).toBe("continue");
    expect(
      getPlaybackInstruction({
        ...state,
        mode: "reveal",
        segment: { startSeconds: 108, endSeconds: 115 },
        currentTime: 114.8,
      }),
    ).toBe("complete");
  });
  it("fails closed when provider time is invalid", () =>
    expect(getPlaybackInstruction({ ...state, currentTime: Number.NaN })).toBe(
      "pause",
    ));
});
