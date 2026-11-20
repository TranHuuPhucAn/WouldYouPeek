"use client";

import type { AnswerResponse, ChallengeDetail } from "@/contracts/challenge";
import type { PlaybackContext } from "@/contracts/video";
import type { PlaybackMode } from "@/lib/video/segment-controller";
import type { ScenarioPlaybackEvent } from "@/lib/video/playback-events";
import { YouTubeScenarioPlayer } from "./YouTubeScenarioPlayer";
import { UploadedScenarioPlayer } from "./UploadedScenarioPlayer";
import { ScenarioMedia } from "./ScenarioMedia";

export function ScenarioPlayback({
  challenge,
  answer,
  mode,
  context,
  analysisVisible,
  playbackKey,
  autoplay,
  onPlaybackEvent,
  onComplete,
  onReadAnalysis,
}: {
  challenge: ChallengeDetail;
  answer?: AnswerResponse | null;
  mode: PlaybackMode;
  context?: PlaybackContext;
  analysisVisible: boolean;
  playbackKey: string;
  autoplay: boolean;
  onPlaybackEvent: (event: ScenarioPlaybackEvent) => void;
  onComplete?: () => void;
  onReadAnalysis: () => void;
}) {
  const reveal = answer?.reveal;
  const hideCaption = mode === "reveal" && !analysisVisible;
  const props = {
    mode,
    playbackKey,
    autoplay,
    onPlaybackEvent,
    onComplete,
    hideCaption,
  };
  // Keep the original answer immutable; neutral display text must not reveal its outcome early.
  const displayedReveal =
    reveal && hideCaption
      ? { ...reveal, alt: "Watch the continuation", caption: undefined }
      : reveal;
  if (mode === "reveal" && !reveal)
    return <p role="alert">The saved continuation is unavailable.</p>;
  if (challenge.setup.kind === "youtube")
    return (
      <YouTubeScenarioPlayer
        setup={challenge.setup}
        reveal={
          displayedReveal?.kind === "youtube" ? displayedReveal : undefined
        }
        {...props}
      />
    );
  if (challenge.setup.kind === "uploaded-video")
    return context ? (
      <UploadedScenarioPlayer
        setup={challenge.setup}
        reveal={
          displayedReveal?.kind === "uploaded-video"
            ? displayedReveal
            : undefined
        }
        context={context}
        {...props}
      />
    ) : (
      <p role="alert">
        This recording is unavailable. Reload this page to try again.
      </p>
    );
  const media =
    mode === "decision" && challenge.decision.kind === "image"
      ? {
          kind: "illustration" as const,
          src: challenge.decision.imageUrl,
          alt: challenge.decision.alt,
        }
      : mode === "reveal" && displayedReveal
        ? displayedReveal
        : challenge.setup;
  return (
    <ScenarioMedia
      media={media}
      label={
        mode === "decision"
          ? "Decision paused"
          : mode === "reveal"
            ? "Authored continuation"
            : "Watch the setup"
      }
      context={context}
      {...props}
      onComplete={
        mode === "setup"
          ? onComplete
          : mode === "reveal" &&
              media.kind === "illustration" &&
              !analysisVisible
            ? onReadAnalysis
            : undefined
      }
      completeLabel={mode === "reveal" ? "Read analysis" : undefined}
    />
  );
}
