"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  getChallenge,
  getChallenges,
  submitAnswer,
  validateAnswerForChallenge,
} from "@/lib/client/challenge-api";
import {
  createInitialSessionState,
  sessionReducer,
} from "@/lib/session/session-reducer";

export function useChallengeSession() {
  const [state, dispatch] = useReducer(
    sessionReducer,
    undefined,
    createInitialSessionState,
  );
  const submission = useRef<AbortController | null>(null);

  useEffect(() => {
    if (state.phase !== "loading") return;
    const controller = new AbortController();
    async function loadResource() {
      try {
        if (state.loadTarget === "catalogue") {
          const challenges = await getChallenges(controller.signal);
          if (!controller.signal.aborted)
            dispatch({ type: "CATALOGUE_LOADED", challenges });
        } else {
          const challenge = await getChallenge(
            state.catalogue[state.currentIndex].id,
            controller.signal,
          );
          if (!controller.signal.aborted)
            dispatch({ type: "CHALLENGE_LOADED", challenge });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          dispatch({
            type: "LOAD_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "The scenario couldn't load. Please try again.",
          });
      }
    }
    void loadResource();
    return () => controller.abort();
  }, [state.phase, state.loadTarget, state.currentIndex, state.catalogue]);

  useEffect(() => () => submission.current?.abort(), []);

  async function submitSelection() {
    if (
      state.phase !== "decision" ||
      !state.challenge ||
      !state.selectedOptionId ||
      submission.current
    )
      return;
    const controller = new AbortController();
    submission.current = controller;
    dispatch({ type: "SUBMIT_STARTED" });
    try {
      const answer = await submitAnswer(
        state.challenge.id,
        { optionId: state.selectedOptionId },
        controller.signal,
      );
      validateAnswerForChallenge(answer, state.challenge);
      if (!controller.signal.aborted)
        dispatch({ type: "SUBMIT_SUCCEEDED", answer });
    } catch (error) {
      if (!controller.signal.aborted)
        dispatch({
          type: "SUBMIT_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Your answer couldn't be submitted. Please try again.",
        });
    } finally {
      if (submission.current === controller) submission.current = null;
    }
  }

  return {
    state,
    submitSelection,
    completeSetup: () =>
      dispatch({ type: "SETUP_FINISHED", challengeId: state.challenge?.id }),
    selectOption: (optionId: string) =>
      dispatch({ type: "SELECT_OPTION", optionId }),
    replaySetup: () => dispatch({ type: "REPLAY_SETUP" }),
    showReviewSetup: () =>
      dispatch({ type: "SET_REVIEW_MEDIA", media: "setup" }),
    showReviewOutcome: () =>
      dispatch({ type: "SET_REVIEW_MEDIA", media: "outcome" }),
    nextChallenge: () => dispatch({ type: "NEXT_CHALLENGE" }),
    retryLoad: () => dispatch({ type: "RETRY_LOAD" }),
    restart: () => {
      submission.current?.abort();
      submission.current = null;
      dispatch({ type: "RESTART" });
    },
  };
}
