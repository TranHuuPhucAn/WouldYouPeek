import type { PlaybackMode } from "@/lib/video/segment-controller";
import {
  isCurrentPlaybackEvent,
  type ScenarioPlaybackEvent,
  type ScenarioPlaybackStatus,
} from "@/lib/video/playback-events";

export type ReviewPresentationInput = {
  scopeKey: string;
  answerKey: string | null;
  mode: PlaybackMode;
  /** Only an intentional replay mount opts in; saved reviews stay quiet. */
  autoplayOnMount?: boolean;
};

export type ReviewPresentationState = {
  scopeKey: string;
  answerKey: string | null;
  mode: PlaybackMode;
  generation: number;
  analysisVisible: boolean;
  status: ScenarioPlaybackStatus;
  autoplay: boolean;
};

export type ReviewPresentationAction =
  | { type: "SYNC"; input: ReviewPresentationInput }
  | { type: "PLAYBACK"; event: ScenarioPlaybackEvent }
  | { type: "SHOW_ANALYSIS"; playbackKey: string }
  | { type: "RESTART"; playbackKey: string };

export function createReviewPresentation(
  input: ReviewPresentationInput,
): ReviewPresentationState {
  return {
    scopeKey: input.scopeKey,
    answerKey: input.answerKey,
    mode: input.mode,
    generation: 0,
    analysisVisible: input.answerKey !== null,
    status: "idle",
    autoplay: input.mode !== "decision" && input.autoplayOnMount === true,
  };
}

export function synchronizeReviewPresentation(
  state: ReviewPresentationState,
  input: ReviewPresentationInput,
): ReviewPresentationState {
  if (state.scopeKey !== input.scopeKey)
    return {
      ...createReviewPresentation(input),
      generation: state.generation + 1,
    };
  if (state.answerKey !== input.answerKey) {
    const freshAnswer = state.answerKey === null && input.answerKey !== null;
    return {
      ...createReviewPresentation(input),
      generation: state.generation + 1,
      analysisVisible: freshAnswer ? false : input.answerKey !== null,
      autoplay: freshAnswer && input.mode !== "decision",
    };
  }
  if (state.mode !== input.mode)
    return {
      ...state,
      mode: input.mode,
      generation: state.generation + 1,
      status: "idle",
      autoplay: input.mode === "decision" ? false : state.autoplay,
    };
  return state;
}

export function getPlaybackKey(state: ReviewPresentationState): string {
  return JSON.stringify([
    state.scopeKey,
    state.answerKey,
    state.mode,
    state.generation,
  ]);
}

export function reviewPresentationReducer(
  state: ReviewPresentationState,
  action: ReviewPresentationAction,
): ReviewPresentationState {
  if (action.type === "SYNC")
    return synchronizeReviewPresentation(state, action.input);

  const playbackKey = getPlaybackKey(state);
  if (action.type === "PLAYBACK") {
    const { event } = action;
    if (!isCurrentPlaybackEvent(event, { playbackKey, mode: state.mode }))
      return state;
    // A decision frame is never playing, even if a provider sends a late event.
    if (state.mode === "decision") return state;
    const status = event.type === "started" ? "playing" : event.type;
    const analysisVisible =
      state.analysisVisible ||
      (event.type === "complete" &&
        state.mode === "reveal" &&
        state.answerKey !== null);
    if (status === state.status && analysisVisible === state.analysisVisible)
      return state;
    return { ...state, status, analysisVisible };
  }

  // An event handler retained by a preceding item cannot act on its successor.
  if (action.playbackKey !== playbackKey) return state;
  if (action.type === "SHOW_ANALYSIS") {
    if (state.answerKey === null) return state;
    if (state.analysisVisible && !state.autoplay) return state;
    return { ...state, analysisVisible: true, autoplay: false };
  }
  // Replay setup can select the next mode in the same batched event. The
  // adapter still freezes decision mode until that canonical mode changes.
  return {
    ...state,
    generation: state.generation + 1,
    status: "idle",
    autoplay: true,
  };
}
