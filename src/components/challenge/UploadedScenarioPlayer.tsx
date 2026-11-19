"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadedVideoSegment } from "@/contracts/challenge";
import type { PlaybackContext } from "@/contracts/video";
import { useUploadedPlayback } from "@/hooks/use-uploaded-playback";
import {
  getPlaybackInstruction,
  PAUSE_MARGIN_SECONDS,
  validateSegment,
  type PlaybackMode,
} from "@/lib/video/segment-controller";

type Props = {
  setup: UploadedVideoSegment;
  reveal?: UploadedVideoSegment;
  mode: PlaybackMode;
  context: PlaybackContext;
  onComplete?: () => void;
};
export function UploadedScenarioPlayer({
  setup,
  reveal,
  mode,
  context,
  onComplete,
}: Props) {
  const element = useRef<HTMLVideoElement>(null);
  const setVideoElement = useCallback((video: HTMLVideoElement | null) => {
    if (element.current && element.current !== video) element.current.pause();
    element.current = video;
  }, []);
  const current = useRef({ setup, reveal, mode, onComplete });
  current.current = { setup, reveal, mode, onComplete };
  const [positioned, setPositioned] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const running = useRef({ finished: false, positioned: false });
  const priorRange = useRef("");
  const desired = useRef({ time: setup.startSeconds, play: false });
  const recovering = useRef(false);
  const segment = mode === "reveal" ? reveal : setup;
  const valid =
    !!segment && validateSegment(segment) && segment.assetId === setup.assetId;
  const access = useUploadedPlayback(
    valid ? context : null,
    valid ? setup.assetId : null,
    () => {
      const video = element.current;
      if (video && running.current.positioned) {
        desired.current = {
          time: video.currentTime,
          play:
            !video.paused &&
            current.current.mode !== "decision" &&
            !running.current.finished,
        };
      }
      running.current.positioned = false;
      setPositioned(false);
      if (video) {
        video.pause();
        video.style.visibility = "hidden";
      }
    },
  );

  function bounds() {
    return current.current.mode === "reveal"
      ? current.current.reveal
      : current.current.setup;
  }
  function safeTime(time: number) {
    const active = bounds();
    if (!active) return 0;
    const last = active.endSeconds - PAUSE_MARGIN_SECONDS;
    return current.current.mode === "decision"
      ? last
      : Math.max(
          active.startSeconds,
          Math.min(last, Number.isFinite(time) ? time : active.startSeconds),
        );
  }
  async function play() {
    const video = element.current,
      active = bounds();
    if (
      !video ||
      !active ||
      current.current.mode === "decision" ||
      access.invalid ||
      access.error ||
      mediaError
    )
      return;
    if (running.current.finished) {
      running.current.finished = false;
      setFinished(false);
      desired.current = { time: active.startSeconds, play: true };
      positionVideo();
      return;
    }
    if (!running.current.positioned) return;
    try {
      await video.play();
    } catch {
      setPlaying(false);
    }
  }
  function pause() {
    element.current?.pause();
    setPlaying(false);
    desired.current.play = false;
  }
  function exposePosition() {
    const video = element.current;
    if (!video) return;
    const target = safeTime(desired.current.time);
    if (Math.abs(video.currentTime - target) > 0.2) {
      video.currentTime = target;
      return;
    }
    running.current.positioned = true;
    setPositioned(true);
    video.style.visibility = "visible";
    if (current.current.mode === "decision" || running.current.finished) {
      video.pause();
      setPlaying(false);
    } else if (desired.current.play && !document.hidden)
      void video.play().catch(() => setPlaying(false));
    recovering.current = false;
  }
  function positionVideo() {
    const video = element.current;
    if (!video || video.readyState < 1 || !bounds()) return;
    video.pause();
    video.style.visibility = "hidden";
    running.current.positioned = false;
    setPositioned(false);
    const target = safeTime(desired.current.time);
    if (Math.abs(video.currentTime - target) < 0.01 && !video.seeking)
      exposePosition();
    else video.currentTime = target;
  }
  function completeSegment() {
    const video = element.current,
      active = bounds();
    if (!video || !active || running.current.finished) return;
    running.current.finished = true;
    setFinished(true);
    video.pause();
    setPlaying(false);
    desired.current.play = false;
    const safeEnd = active.endSeconds - PAUSE_MARGIN_SECONDS;
    if (video.currentTime > safeEnd) {
      desired.current.time = safeEnd;
      positionVideo();
    }
    if (current.current.mode === "setup") current.current.onComplete?.();
  }
  function checkPosition() {
    const video = element.current,
      active = bounds();
    if (!video || !active || !running.current.positioned) return;
    const instruction = getPlaybackInstruction({
      mode: current.current.mode,
      segment: active,
      currentTime: video.currentTime,
      playing: !video.paused,
      finished: running.current.finished,
    });
    if (instruction === "complete") completeSegment();
    else if (instruction === "pause") {
      video.pause();
      setPlaying(false);
      if (video.currentTime > active.endSeconds - PAUSE_MARGIN_SECONDS) {
        desired.current.time = safeTime(video.currentTime);
        desired.current.play = false;
        positionVideo();
      }
    } else if (instruction === "restart") {
      desired.current = { time: active.startSeconds, play: true };
      positionVideo();
    }
  }
  useEffect(() => {
    const next = `${setup.assetId}:${segment?.startSeconds}:${segment?.endSeconds}:${mode}`;
    if (priorRange.current === next) return;
    const prior = priorRange.current;
    priorRange.current = next;
    running.current.finished = mode === "decision";
    setFinished(mode === "decision");
    setMediaError(null);
    desired.current = {
      time:
        mode === "decision"
          ? setup.endSeconds - PAUSE_MARGIN_SECONDS
          : (segment?.startSeconds ?? 0),
      play: mode !== "decision" && (mode !== "setup" || !!prior),
    };
    positionVideo();
  }, [
    mode,
    setup.assetId,
    setup.startSeconds,
    setup.endSeconds,
    segment?.startSeconds,
    segment?.endSeconds,
  ]);
  useEffect(() => {
    const timer = setInterval(checkPosition, 50);
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      element.current?.pause();
    };
  }, []);
  useEffect(() => {
    if (access.error || access.invalid || mediaError) pause();
  }, [access.error, access.invalid, mediaError]);
  function mediaFailed() {
    pause();
    setPositioned(false);
    if (element.current) element.current.style.visibility = "hidden";
    if (!recovering.current && !access.invalid) {
      recovering.current = true;
      void access.refresh().then(() => element.current?.load());
    } else
      setMediaError(
        "The recording could not play. Check your connection and retry playback.",
      );
  }
  const label =
    mode === "decision"
      ? "Decision paused"
      : mode === "reveal"
        ? "Recorded continuation"
        : mode === "review-setup"
          ? "Replay setup"
          : "Setup playback";
  const error = !valid
    ? "This saved recording has invalid timing."
    : (access.error ?? mediaError);
  return (
    <section
      className="media-card uploaded-player"
      aria-label={label}
      data-playback-mode={mode}
    >
      <div className="media-topline">
        <span>
          <i className="live-dot" />
          {label}
        </span>
        <span className="mono">PLAYER RECORDING</span>
      </div>
      <div className="media-viewport uploaded-viewport">
        {access.access?.assetId === setup.assetId && !access.invalid && (
          <video
            ref={setVideoElement}
            src={access.access.url}
            playsInline
            preload="auto"
            aria-label={segment?.alt ?? setup.alt}
            style={{ visibility: positioned && !error ? "visible" : "hidden" }}
            onLoadedMetadata={() => {
              if (element.current) element.current.volume = volume;
              positionVideo();
            }}
            onSeeked={exposePosition}
            onSeeking={() => {
              const video = element.current;
              if (!video) return;
              video.style.visibility = "hidden";
              if (running.current.positioned) {
                desired.current = {
                  time: safeTime(video.currentTime),
                  play:
                    !video.paused &&
                    current.current.mode !== "decision" &&
                    !running.current.finished,
                };
              }
              running.current.positioned = false;
              setPositioned(false);
            }}
            onTimeUpdate={checkPosition}
            onEnded={completeSegment}
            onError={mediaFailed}
            onPlay={() => {
              if (
                current.current.mode === "decision" ||
                document.hidden ||
                !running.current.positioned ||
                running.current.finished
              )
                pause();
              else setPlaying(true);
            }}
            onPause={() => setPlaying(false)}
          />
        )}
        {!positioned && !error && (
          <p className="media-loading" role="status">
            Loading recording…
          </p>
        )}
      </div>
      {error ? (
        <div className="media-error" role="alert">
          <p>{error}</p>
          {!access.invalid && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setMediaError(null);
                recovering.current = false;
                void access.refresh().then(() => element.current?.load());
              }}
            >
              Retry playback
            </button>
          )}
        </div>
      ) : (
        <div className="media-action">
          <span>
            {mode === "decision"
              ? "Make your choice before the recording continues."
              : finished
                ? "Segment finished."
                : playing
                  ? "Playing"
                  : "Ready when you are."}
          </span>
          <button
            type="button"
            className="button button-primary"
            disabled={!positioned || mode === "decision" || access.loading}
            onClick={() => (playing ? pause() : void play())}
          >
            {playing ? "Pause" : finished ? "Replay segment" : "Play"}
          </button>
          <label className="volume-control">
            Volume
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => {
                const next = Number(event.target.value);
                setVolume(next);
                if (element.current) element.current.volume = next;
              }}
            />
          </label>
        </div>
      )}
      {segment?.caption && <p className="media-caption">{segment.caption}</p>}
    </section>
  );
}
