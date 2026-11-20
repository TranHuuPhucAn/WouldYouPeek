import { describe, expect, it } from "vitest";
import {
  createReviewPresentation,
  getPlaybackKey,
  reviewPresentationReducer,
  synchronizeReviewPresentation,
  type ReviewPresentationInput,
  type ReviewPresentationState,
} from "@/lib/session/review-presentation";
import {
  isCurrentPlaybackEvent,
  type ScenarioPlaybackEvent,
} from "@/lib/video/playback-events";

const setup: ReviewPresentationInput = {
  scopeKey: JSON.stringify(["viewer", "session", "item", "version"]),
  answerKey: null,
  mode: "setup",
};
const answered = {
  ...setup,
  answerKey: "saved-answer",
  mode: "reveal" as const,
};
function freshAnswer() {
  return synchronizeReviewPresentation(
    createReviewPresentation(setup),
    answered,
  );
}
function event(
  state: ReviewPresentationState,
  type: ScenarioPlaybackEvent["type"],
): ScenarioPlaybackEvent {
  return { playbackKey: getPlaybackKey(state), mode: state.mode, type };
}
function playback(
  state: ReviewPresentationState,
  type: ScenarioPlaybackEvent["type"],
) {
  return reviewPresentationReducer(state, {
    type: "PLAYBACK",
    event: event(state, type),
  });
}

describe("review presentation without a second saved-session lifecycle", () => {
  it("initializes setup without feedback or automatic playback", () => {
    expect(createReviewPresentation(setup)).toMatchObject({
      analysisVisible: false,
      autoplay: false,
      status: "idle",
    });
  });

  it("opens a previously saved answer immediately and quietly", () => {
    expect(createReviewPresentation(answered)).toMatchObject({
      analysisVisible: true,
      autoplay: false,
    });
    expect(
      createReviewPresentation({ ...answered, autoplayOnMount: true }),
    ).toMatchObject({ analysisVisible: true, autoplay: true });
  });

  it("gates a newly confirmed answer regardless of whether POST or reconciliation supplied it", () => {
    for (const previousMode of ["setup", "decision"] as const) {
      const state = synchronizeReviewPresentation(
        createReviewPresentation({ ...setup, mode: previousMode }),
        answered,
      );
      expect(state).toMatchObject({
        answerKey: "saved-answer",
        analysisVisible: false,
        autoplay: true,
      });
      expect(playback(state, "complete").analysisVisible).toBe(true);
    }
  });

  it("cannot open analysis for a selection or unconfirmed save", () => {
    const state = createReviewPresentation({ ...setup, mode: "decision" });
    expect(
      reviewPresentationReducer(state, {
        type: "SHOW_ANALYSIS",
        playbackKey: getPlaybackKey(state),
      }),
    ).toBe(state);
    expect(playback(state, "complete")).toBe(state);
    expect(
      playback(createReviewPresentation(setup), "complete").analysisVisible,
    ).toBe(false);
  });

  it("only active reveal completion releases the first continuation gate", () => {
    const state = freshAnswer();
    expect(playback(state, "started")).toMatchObject({
      status: "playing",
      analysisVisible: false,
    });
    const oldSetup = event(createReviewPresentation(setup), "complete");
    expect(
      reviewPresentationReducer(state, { type: "PLAYBACK", event: oldSetup }),
    ).toBe(state);
    const wrongMode = { ...event(state, "complete"), mode: "setup" as const };
    expect(
      reviewPresentationReducer(state, { type: "PLAYBACK", event: wrongMode }),
    ).toBe(state);
    const reviewingSetup = synchronizeReviewPresentation(state, {
      ...answered,
      mode: "review-setup",
    });
    expect(playback(reviewingSetup, "complete").analysisVisible).toBe(false);
    const complete = playback(state, "complete");
    expect(complete).toMatchObject({
      status: "complete",
      analysisVisible: true,
    });
    expect(playback(complete, "complete")).toBe(complete);
  });

  it.each(["blocked", "error"] as const)(
    "keeps %s distinct from completion and permits an explicit saved-analysis escape",
    (status) => {
      const state = playback(freshAnswer(), status);
      expect(state).toMatchObject({ status, analysisVisible: false });
      const read = reviewPresentationReducer(state, {
        type: "SHOW_ANALYSIS",
        playbackKey: getPlaybackKey(state),
      });
      expect(read).toMatchObject({
        analysisVisible: true,
        autoplay: false,
        answerKey: state.answerKey,
      });
      expect(getPlaybackKey(read)).toBe(getPlaybackKey(state));
    },
  );

  it("supports an explicit escape from a silent stall and a deliberate image acknowledgement", () => {
    const state = freshAnswer();
    const read = reviewPresentationReducer(state, {
      type: "SHOW_ANALYSIS",
      playbackKey: getPlaybackKey(state),
    });
    expect(read).toMatchObject({
      analysisVisible: true,
      status: "idle",
      autoplay: false,
    });
    expect(read.status).not.toBe("complete");
  });

  it("does not re-hide an opened answer or restart video on repeated hydration", () => {
    const state = playback(freshAnswer(), "complete");
    expect(synchronizeReviewPresentation(state, { ...answered })).toBe(state);
    expect(
      synchronizeReviewPresentation(state, {
        ...answered,
        autoplayOnMount: true,
      }),
    ).toBe(state);
  });

  it("replays with a different attempt key while retaining already visible analysis", () => {
    const state = createReviewPresentation(answered);
    const replay = reviewPresentationReducer(state, {
      type: "RESTART",
      playbackKey: getPlaybackKey(state),
    });
    expect(replay).toMatchObject({
      analysisVisible: true,
      answerKey: state.answerKey,
      autoplay: true,
    });
    expect(getPlaybackKey(replay)).not.toBe(getPlaybackKey(state));
    expect(
      reviewPresentationReducer(replay, {
        type: "PLAYBACK",
        event: event(state, "complete"),
      }),
    ).toBe(replay);
    expect(
      synchronizeReviewPresentation(replay, {
        ...answered,
        mode: "review-setup",
      }),
    ).toMatchObject({ analysisVisible: true, autoplay: true, status: "idle" });
  });

  it("retains explicit replay intent when setup is selected from the paused decision", () => {
    const decision = createReviewPresentation({ ...setup, mode: "decision" });
    const replay = reviewPresentationReducer(decision, {
      type: "RESTART",
      playbackKey: getPlaybackKey(decision),
    });
    expect(synchronizeReviewPresentation(replay, setup)).toMatchObject({
      mode: "setup",
      analysisVisible: false,
      autoplay: true,
    });
    expect(playback(replay, "complete")).toBe(replay);
  });

  it.each(["viewer", "session", "item", "version"])(
    "invalidates old %s scope events and UI handlers immediately",
    (part) => {
      const state = freshAnswer();
      const next = synchronizeReviewPresentation(state, {
        ...setup,
        scopeKey: `${setup.scopeKey}:new-${part}`,
      });
      expect(next).toMatchObject({ analysisVisible: false, autoplay: false });
      for (const action of [
        { type: "PLAYBACK", event: event(state, "complete") },
        { type: "SHOW_ANALYSIS", playbackKey: getPlaybackKey(state) },
        { type: "RESTART", playbackKey: getPlaybackKey(state) },
      ] as const)
        expect(reviewPresentationReducer(next, action)).toBe(next);
    },
  );

  it("treats an already answered replacement scope as resumed, not another fresh save", () => {
    const next = synchronizeReviewPresentation(freshAnswer(), {
      ...answered,
      scopeKey: "new-canonical-item",
      answerKey: "other-answer",
    });
    expect(next).toMatchObject({ analysisVisible: true, autoplay: false });
  });

  it("cannot reuse an old activation when navigating away and back to the same scope", () => {
    const original = freshAnswer();
    const elsewhere = synchronizeReviewPresentation(original, {
      ...setup,
      scopeKey: "another-item",
    });
    const returned = synchronizeReviewPresentation(elsewhere, answered);
    expect(getPlaybackKey(returned)).not.toBe(getPlaybackKey(original));
    expect(
      reviewPresentationReducer(returned, {
        type: "PLAYBACK",
        event: event(original, "error"),
      }),
    ).toBe(returned);
  });

  it("invalidates old events when switching away and back to a playback mode", () => {
    const original = freshAnswer();
    const setupReplay = synchronizeReviewPresentation(original, {
      ...answered,
      mode: "review-setup",
    });
    const returned = synchronizeReviewPresentation(setupReplay, answered);
    expect(getPlaybackKey(returned)).not.toBe(getPlaybackKey(original));
    expect(
      reviewPresentationReducer(returned, {
        type: "PLAYBACK",
        event: event(original, "complete"),
      }),
    ).toBe(returned);
    expect(returned.analysisVisible).toBe(false);
  });

  it("includes answer, mode and unambiguous composite values in event identity", () => {
    const state = createReviewPresentation(answered);
    const other = createReviewPresentation({ ...answered, answerKey: "other" });
    expect(getPlaybackKey(other)).not.toBe(getPlaybackKey(state));
    expect(
      isCurrentPlaybackEvent(event(other, "complete"), {
        playbackKey: getPlaybackKey(state),
        mode: state.mode,
      }),
    ).toBe(false);
    expect(JSON.parse(getPlaybackKey(state))).toEqual([
      answered.scopeKey,
      answered.answerKey,
      answered.mode,
      0,
    ]);
  });
});
