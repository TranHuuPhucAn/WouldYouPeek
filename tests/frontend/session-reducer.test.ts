import { describe, expect, it } from "vitest";
import {
  createInitialSessionState,
  sessionReducer,
} from "@/lib/session/session-reducer";
import { snapshot, viewer } from "./session-fixtures";
const initial = () =>
  createInitialSessionState({ snapshot: snapshot(), viewerId: viewer.id });
describe("persistent session reducer", () => {
  it("requires setup completion and rejects late completion from another scenario", () => {
    const state = initial();
    expect(
      sessionReducer(state, { type: "SETUP_FINISHED", challengeId: "wrong" }),
    ).toBe(state);
    expect(sessionReducer(state, { type: "SETUP_FINISHED" }).phase).toBe(
      "decision",
    );
  });
  it("keeps an unsubmitted selection during replay", () => {
    let state = sessionReducer(initial(), { type: "SETUP_FINISHED" });
    state = sessionReducer(state, { type: "SELECT_OPTION", optionId: "hold" });
    state = sessionReducer(state, { type: "REPLAY_SETUP" });
    expect(state.selectedOptionId).toBe("hold");
    expect(state.snapshot.items[0].answer).toBeNull();
  });
  it("rejects invalid selection and unresolved command changes", () => {
    let state = sessionReducer(initial(), { type: "SETUP_FINISHED" });
    expect(
      sessionReducer(state, { type: "SELECT_OPTION", optionId: "bad" }),
    ).toBe(state);
    state = sessionReducer(state, {
      type: "COMMAND_FAILED",
      message: "Retry",
      unresolved: true,
    });
    expect(
      sessionReducer(state, { type: "SELECT_OPTION", optionId: "hold" }),
    ).toBe(state);
  });
  it("reveals only canonical saved feedback and never completes final review locally", () => {
    const state = sessionReducer(initial(), {
      type: "HYDRATE",
      snapshot: snapshot("review", 2),
      viewerId: viewer.id,
    });
    expect(state.phase).toBe("review");
    expect(state.completed).toHaveLength(3);
    const pending = sessionReducer(state, { type: "COMMAND_STARTED" });
    expect(pending.phase).toBe("review");
    expect(
      sessionReducer(pending, {
        type: "COMMAND_FAILED",
        message: "Offline",
        unresolved: true,
      }).feedback,
    ).toEqual(state.feedback);
  });
  it("rejects older revisions, foreign session and changed identity", () => {
    const state = createInitialSessionState({
      snapshot: snapshot("review"),
      viewerId: viewer.id,
    });
    for (const [next, id] of [
      [snapshot(), viewer.id],
      [{ ...snapshot("review"), id: "other" }, viewer.id],
      [snapshot("review"), "another-user"],
    ] as const)
      expect(
        sessionReducer(state, {
          type: "HYDRATE",
          snapshot: next,
          viewerId: id,
        }),
      ).toBe(state);
  });
  it("clears displayed private state on signout and ignores late hydration", () => {
    const state = sessionReducer(initial(), { type: "AUTH_REQUIRED" });
    expect(state.challenge).toBeNull();
    expect(state.completed).toEqual([]);
    expect(
      sessionReducer(state, {
        type: "HYDRATE",
        snapshot: snapshot("review"),
        viewerId: viewer.id,
      }),
    ).toBe(state);
  });
});
