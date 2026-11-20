"use client";

import { useId, useRef } from "react";
import type { SessionItem } from "@/contracts/session";
import { useReviewPresentation } from "@/hooks/use-review-presentation";
import { FeedbackPanel } from "./FeedbackPanel";
import { ScenarioPlayback } from "./ScenarioPlayback";

export type SavedReplay = {
  itemId: string;
  media: "setup" | "outcome";
  attempt: number;
};
function SavedReplayPlayer({
  item,
  sessionId,
  viewerId,
  replay,
}: {
  item: SessionItem;
  sessionId: string;
  viewerId: string;
  replay: SavedReplay;
}) {
  const mode = replay.media === "setup" ? "review-setup" : "reveal";
  const presentation = useReviewPresentation({
    scopeKey: JSON.stringify([
      "saved",
      viewerId,
      sessionId,
      item.id,
      item.challenge.contentVersion,
      replay.attempt,
    ]),
    answerKey: item.answer!.id,
    mode,
    autoplayOnMount: true,
  });
  return (
    <ScenarioPlayback
      challenge={item.challenge}
      answer={item.answer!.result}
      mode={mode}
      context={{
        kind: "session-item",
        sessionId,
        itemId: item.id,
        phase: replay.media === "setup" ? "setup" : "reveal",
      }}
      analysisVisible
      playbackKey={presentation.playbackKey}
      autoplay={presentation.autoplay}
      onPlaybackEvent={presentation.onPlaybackEvent}
      onReadAnalysis={presentation.showAnalysis}
    />
  );
}
export function SavedScenarioReview({
  item,
  sessionId,
  viewerId,
  replay,
  onReplay,
  onClose,
}: {
  item: SessionItem;
  sessionId: string;
  viewerId: string;
  replay: SavedReplay | null;
  onReplay: (media: "setup" | "outcome") => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const setupButton = useRef<HTMLButtonElement>(null);
  const continuationButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  if (!item.answer) return null;
  return (
    <div className="saved-scenario-review">
      <div
        className="saved-replay-controls"
        aria-label={`Replay ${item.challenge.title}`}
      >
        <button
          ref={setupButton}
          className="button button-secondary"
          onClick={() => onReplay("setup")}
        >
          Watch setup
        </button>
        <button
          ref={continuationButton}
          className="button button-secondary"
          onClick={() => onReplay("outcome")}
        >
          Watch continuation
        </button>
        {replay && (
          <button
            className="text-button"
            onClick={() => {
              const trigger =
                replay.media === "setup" ? setupButton : continuationButton;
              onClose();
              trigger.current?.focus();
            }}
          >
            Close video
          </button>
        )}
      </div>
      {replay && (
        <SavedReplayPlayer
          key={`${item.id}:${replay.attempt}`}
          item={item}
          sessionId={sessionId}
          viewerId={viewerId}
          replay={replay}
        />
      )}
      <FeedbackPanel
        challenge={item.challenge}
        answer={item.answer.result}
        headingId={id}
        headingRef={heading}
      />
    </div>
  );
}
