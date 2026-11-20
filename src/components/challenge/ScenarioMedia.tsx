"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaAsset } from "@/contracts/challenge";
import type { PlaybackContext } from "@/contracts/video";
import type { PlaybackMode } from "@/lib/video/segment-controller";
import type { ScenarioPlaybackEvent } from "@/lib/video/playback-events";
import { UploadedScenarioPlayer } from "./UploadedScenarioPlayer";
import { YouTubeScenarioPlayer } from "./YouTubeScenarioPlayer";

type Props = {
  media: MediaAsset;
  label: string;
  onComplete?: () => void;
  context?: PlaybackContext;
  mode?: PlaybackMode;
  playbackKey?: string;
  onPlaybackEvent?: (event: ScenarioPlaybackEvent) => void;
  autoplay?: boolean;
  hideCaption?: boolean;
  completeLabel?: string;
};
export function ScenarioMedia({
  media,
  label,
  onComplete,
  context,
  mode = "setup",
  playbackKey = "legacy",
  onPlaybackEvent,
  autoplay,
  hideCaption = false,
  completeLabel = "Continue to decision",
}: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const identity = `${playbackKey}:${mode}:${"src" in media ? media.src : media.kind}:${attempt}`;
  const active = useRef(identity);
  active.current = identity;
  const priorIntent = useRef(autoplay);
  const complete = useRef<string | null>(null);
  function emit(type: ScenarioPlaybackEvent["type"]) {
    if (active.current === identity)
      onPlaybackEvent?.({ playbackKey, mode, type });
  }
  useEffect(() => {
    setFailed(false);
    complete.current = null;
    const node = video.current;
    return () => {
      if (node && !node.paused) node.pause();
    };
  }, [identity]);
  useEffect(() => {
    if (priorIntent.current === true && autoplay === false)
      video.current?.pause();
    priorIntent.current = autoplay;
  }, [autoplay]);
  function handleMediaError() {
    if (active.current !== identity) return;
    setFailed(true);
    emit("error");
  }
  function retryMedia() {
    setFailed(false);
    setAttempt((value) => value + 1);
  }
  const presentation = { playbackKey, onPlaybackEvent, autoplay, hideCaption };
  if (media.kind === "youtube")
    return (
      <YouTubeScenarioPlayer
        setup={media}
        mode={mode}
        onComplete={onComplete}
        {...presentation}
      />
    );
  if (media.kind === "uploaded-video")
    return context ? (
      <UploadedScenarioPlayer
        setup={media}
        mode={mode}
        context={context}
        onComplete={onComplete}
        {...presentation}
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
                key={identity}
                ref={video}
                src={media.src}
                aria-label={media.alt}
                controls
                playsInline
                preload="metadata"
                onLoadedData={(event) => {
                  const node = event.currentTarget;
                  if (
                    autoplay &&
                    mode !== "decision" &&
                    active.current === identity
                  )
                    void node.play().catch(() => emit("blocked"));
                }}
                onPlay={() => emit("started")}
                onEnded={() => {
                  if (
                    active.current !== identity ||
                    complete.current === identity
                  )
                    return;
                  complete.current = identity;
                  emit("complete");
                  if (mode === "setup") onComplete?.();
                }}
                onError={handleMediaError}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={identity}
                src={media.src}
                alt={media.alt}
                onError={handleMediaError}
              />
            )}
          </div>
          {!hideCaption && media.caption && (
            <p className="media-caption">{media.caption}</p>
          )}
          {onComplete && media.kind === "illustration" && (
            <div className="media-action">
              <span>
                {mode === "reveal"
                  ? "Read the continuation, then explore the analysis."
                  : "Read the scene. Make your call."}
              </span>
              <button className="button button-primary" onClick={onComplete}>
                {completeLabel}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
