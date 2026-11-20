"use client";

import { useCallback, useState } from "react";
import {
  createReviewPresentation,
  getPlaybackKey,
  reviewPresentationReducer,
  synchronizeReviewPresentation,
  type ReviewPresentationInput,
} from "@/lib/session/review-presentation";
import type { ScenarioPlaybackEvent } from "@/lib/video/playback-events";

/** Local presentation only: canonical answers and commands stay in the session hook. */
export function useReviewPresentation(input: ReviewPresentationInput) {
  const [stored, setStored] = useState(() => createReviewPresentation(input));
  const state = synchronizeReviewPresentation(stored, input);
  // Adjust before children render so a new item never paints the old debrief.
  // Equal canonical inputs preserve an already-open analysis and replay intent.
  if (state !== stored) setStored(state);
  const playbackKey = getPlaybackKey(state);
  const onPlaybackEvent = useCallback((event: ScenarioPlaybackEvent) => {
    setStored((current) =>
      reviewPresentationReducer(current, { type: "PLAYBACK", event }),
    );
  }, []);
  const showAnalysis = useCallback(() => {
    setStored((current) =>
      reviewPresentationReducer(current, {
        type: "SHOW_ANALYSIS",
        playbackKey,
      }),
    );
  }, [playbackKey]);
  const restartPlayback = useCallback(() => {
    setStored((current) =>
      reviewPresentationReducer(current, { type: "RESTART", playbackKey }),
    );
  }, [playbackKey]);

  return {
    analysisVisible: state.analysisVisible,
    status: state.status,
    playbackKey,
    autoplay: state.autoplay,
    onPlaybackEvent,
    showAnalysis,
    restartPlayback,
  };
}
