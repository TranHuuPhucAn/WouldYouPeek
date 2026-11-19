"use client";

import { useState } from "react";
import type { MediaAsset } from "@/contracts/challenge";
import type { PlaybackContext } from "@/contracts/video";
import { UploadedScenarioPlayer } from "./UploadedScenarioPlayer";
import { YouTubeScenarioPlayer } from "./YouTubeScenarioPlayer";

type Props = {
  media: MediaAsset;
  label: string;
  onComplete?: () => void;
  context?: PlaybackContext;
};

export function ScenarioMedia({ media, label, onComplete, context }: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  function handleMediaError() {
    setFailed(true);
  }
  function retryMedia() {
    setFailed(false);
    setAttempt((value) => value + 1);
  }

  if (media.kind === "youtube")
    return (
      <YouTubeScenarioPlayer
        setup={media}
        mode="setup"
        onComplete={onComplete}
      />
    );

  if (media.kind === "uploaded-video")
    return context ? (
      <UploadedScenarioPlayer
        setup={media}
        mode="setup"
        context={context}
        onComplete={onComplete}
      />
    ) : (
      <p role="alert">
        This recording is unavailable. Reload this page to try again.
      </p>
    );

  return (
    <section className="media-card" aria-label={label}>
      <div className="media-topline">
        <span>
          <i className="live-dot" />
          {label}
        </span>
        <span className="mono">TACTICAL VIEW</span>
      </div>
      {failed ? (
        <div className="media-error" role="alert">
          <span className="error-symbol">!</span>
          <h3>Media couldn’t load</h3>
          <p>Your progress is safe. Try loading this scene again.</p>
          <button className="button button-secondary" onClick={retryMedia}>
            Retry media
          </button>
        </div>
      ) : (
        <>
          <div className="media-viewport">
            {media.kind === "video" ? (
              <video
                key={`${media.src}-${attempt}`}
                src={media.src}
                aria-label={media.alt}
                controls
                playsInline
                preload="metadata"
                onEnded={onComplete}
                onError={handleMediaError}
              />
            ) : (
              // Original local diagrams are intentionally displayed at their authored aspect ratio.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${media.src}-${attempt}`}
                src={media.src}
                alt={media.alt}
                onError={handleMediaError}
              />
            )}
          </div>
          {media.caption && <p className="media-caption">{media.caption}</p>}
          {onComplete && media.kind === "illustration" && (
            <div className="media-action">
              <span>Read the scene. Make your call.</span>
              <button className="button button-primary" onClick={onComplete}>
                Continue to decision <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
