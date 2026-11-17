import { describe, expect, it } from "vitest";
import {
  createInitialSessionState,
  sessionReducer,
  type SessionState,
} from "@/lib/session/session-reducer";
import { answerFor, challenges, summaries } from "./fixtures";

function decisionState(): SessionState {
  let state = sessionReducer(createInitialSessionState(), {
    type: "CATALOGUE_LOADED",
    challenges: summaries,
  });
  state = sessionReducer(state, {
    type: "CHALLENGE_LOADED",
    challenge: challenges[0],
  });
  return sessionReducer(state, { type: "SETUP_FINISHED" });
}

describe("session state rules", () => {
  it("ignores setup completion from another scenario or a completed phase", () => {
    const state = sessionReducer(decisionState(), { type: "REPLAY_SETUP" });
    expect(
      sessionReducer(state, {
        type: "SETUP_FINISHED",
        challengeId: challenges[1].id,
      }),
    ).toBe(state);
    const decision = sessionReducer(state, {
      type: "SETUP_FINISHED",
      challengeId: challenges[0].id,
    });
    expect(decision.phase).toBe("decision");
    expect(
      sessionReducer(decision, {
        type: "SETUP_FINISHED",
        challengeId: challenges[0].id,
      }),
    ).toBe(decision);
  });
  it("begins empty and ignores attempts to skip unanswered challenges", () => {
    const state = createInitialSessionState();
    expect(state.phase).toBe("loading");
    expect(state.completed).toEqual([]);
    expect(sessionReducer(state, { type: "NEXT_CHALLENGE" })).toBe(state);
    expect(
      sessionReducer(decisionState(), { type: "NEXT_CHALLENGE" }).phase,
    ).toBe("decision");
  });
  it("rejects invalid selections and submission without a selection", () => {
    const state = decisionState();
    expect(
      sessionReducer(state, { type: "SELECT_OPTION", optionId: "invalid" }),
    ).toBe(state);
    expect(sessionReducer(state, { type: "SUBMIT_STARTED" })).toBe(state);
  });
  it("preserves a selection through setup replay", () => {
    let state = sessionReducer(decisionState(), {
      type: "SELECT_OPTION",
      optionId: "peek",
    });
    state = sessionReducer(state, { type: "REPLAY_SETUP" });
    expect(state.phase).toBe("setup");
    state = sessionReducer(state, { type: "SETUP_FINISHED" });
    expect(state.selectedOptionId).toBe("peek");
    expect(state.phase).toBe("decision");
  });
  it("keeps the unanswered decision intact when submission fails", () => {
    let state = sessionReducer(decisionState(), {
      type: "SELECT_OPTION",
      optionId: "hold",
    });
    state = sessionReducer(state, { type: "SUBMIT_STARTED" });
    state = sessionReducer(state, {
      type: "SUBMIT_FAILED",
      message: "Try again",
    });
    expect(state.phase).toBe("decision");
    expect(state.selectedOptionId).toBe("hold");
    expect(state.completed).toHaveLength(0);
    expect(state.error).toBe("Try again");
  });
  it("records each answer once, clears next-choice state, and reviews the third answer before recap", () => {
    let state = decisionState();
    for (let index = 0; index < 3; index++) {
      state = sessionReducer(state, {
        type: "SELECT_OPTION",
        optionId: "hold",
      });
      state = sessionReducer(state, { type: "SUBMIT_STARTED" });
      state = sessionReducer(state, {
        type: "SUBMIT_SUCCEEDED",
        answer: answerFor(challenges[index].id),
      });
      expect(state.phase).toBe("review");
      expect(state.completed).toHaveLength(index + 1);
      expect(
        sessionReducer(state, {
          type: "SUBMIT_SUCCEEDED",
          answer: answerFor(challenges[index].id),
        }),
      ).toBe(state);
      expect(
        sessionReducer(state, { type: "SELECT_OPTION", optionId: "peek" }),
      ).toBe(state);
      state = sessionReducer(state, { type: "NEXT_CHALLENGE" });
      if (index < 2) {
        expect(state.selectedOptionId).toBeNull();
        expect(state.feedback).toBeNull();
        state = sessionReducer(state, {
          type: "CHALLENGE_LOADED",
          challenge: challenges[index + 1],
        });
        state = sessionReducer(state, { type: "SETUP_FINISHED" });
      }
    }
    expect(state.phase).toBe("complete");
    expect(sessionReducer(state, { type: "RESTART" })).toEqual(
      createInitialSessionState(),
    );
  });
  it("changes review media without changing the submitted answer", () => {
    let state = sessionReducer(decisionState(), {
      type: "SELECT_OPTION",
      optionId: "hold",
    });
    state = sessionReducer(state, { type: "SUBMIT_STARTED" });
    state = sessionReducer(state, {
      type: "SUBMIT_SUCCEEDED",
      answer: answerFor(),
    });
    const reviewed = sessionReducer(state, {
      type: "SET_REVIEW_MEDIA",
      media: "setup",
    });
    expect(reviewed.reviewMedia).toBe("setup");
    expect(reviewed.completed).toBe(state.completed);
  });
  it("retries a failed load and ignores an unrelated late detail", () => {
    let state = sessionReducer(createInitialSessionState(), {
      type: "CATALOGUE_LOADED",
      challenges: summaries,
    });
    expect(
      sessionReducer(state, {
        type: "CHALLENGE_LOADED",
        challenge: challenges[1],
      }),
    ).toBe(state);
    state = sessionReducer(state, { type: "LOAD_FAILED", message: "Network" });
    expect(state.phase).toBe("error");
    state = sessionReducer(state, { type: "RETRY_LOAD" });
    expect(state.loadTarget).toBe("challenge");
    expect(state.phase).toBe("loading");
    expect(state.error).toBeNull();
  });
});
