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
import type { ScenarioPlaybackEvent } from "@/lib/video/playback-events";

type Props = {
  setup: UploadedVideoSegment;
  reveal?: UploadedVideoSegment;
  mode: PlaybackMode;
  context: PlaybackContext;
  onComplete?: () => void;
  playbackKey?: string;
  onPlaybackEvent?: (event: ScenarioPlaybackEvent) => void;
  autoplay?: boolean;
  suspended?: boolean;
  hideCaption?: boolean;
};
export function UploadedScenarioPlayer({
  setup,
  reveal,
  mode,
  context,
  onComplete,
  playbackKey = "legacy",
  onPlaybackEvent,
  autoplay,
  suspended = false,
  hideCaption = false,
}: Props) {
  const segment = mode === "reveal" ? reveal : setup;
  const activationKey = JSON.stringify([
    playbackKey,
    mode,
    setup.assetId,
    segment?.startSeconds,
    segment?.endSeconds,
  ]);
  const element = useRef<HTMLVideoElement>(null);
  const current = useRef({
    setup,
    reveal,
    mode,
    onComplete,
    playbackKey,
    onPlaybackEvent,
    autoplay,
    suspended,
    activationKey,
  });
  current.current = {
    setup,
    reveal,
    mode,
    onComplete,
    playbackKey,
    onPlaybackEvent,
    autoplay,
    suspended,
    activationKey,
  };
  const running = useRef({
    key: "",
    finished: false,
    positioned: false,
    started: false,
  });
  const generation = useRef(0);
  const [positioned, setPositioned] = useState(false),
    [playing, setPlaying] = useState(false),
    [finished, setFinished] = useState(false),
    [mediaError, setMediaError] = useState<string | null>(null),
    [volume, setVolume] = useState(1);
  const desired = useRef({ time: setup.startSeconds, play: false });
  const recovering = useRef(false);
  const priorIntent = useRef(autoplay);
  const resumeRequired = useRef(suspended);
  const setVideoElement = useCallback((video: HTMLVideoElement | null) => {
    if (element.current === video) return;
    element.current?.pause();
    generation.current++;
    running.current.positioned = false;
    running.current.started = false;
    element.current = video;
    setPositioned(false);
  }, []);
  function isActive() {
    return running.current.key === current.current.activationKey;
  }
  function emit(type: ScenarioPlaybackEvent["type"]) {
    if (isActive())
      current.current.onPlaybackEvent?.({
        playbackKey: current.current.playbackKey,
        mode: current.current.mode,
        type,
      });
  }
  const valid =
    !!segment && validateSegment(segment) && segment.assetId === setup.assetId;
  const access = useUploadedPlayback(
    valid ? context : null,
    valid ? setup.assetId : null,
    () => {
      const video = element.current;
      if (video && isActive() && running.current.positioned)
        desired.current = {
          time: safeTime(video.currentTime),
          play:
            !video.paused &&
            !current.current.suspended &&
            !resumeRequired.current &&
            current.current.mode !== "decision" &&
            !running.current.finished,
        };
      generation.current++;
      running.current.positioned = false;
      running.current.started = false;
      setPositioned(false);
      if (video) {
        video.pause();
        video.style.visibility = "hidden";
      }
    },
  );
  const sourceKey = `${activationKey}:${access.access?.url ?? ""}`;
  const currentSource = useRef(sourceKey);
  currentSource.current = sourceKey;
  function acceptsEvent(video: HTMLVideoElement) {
    return (
      sourceKey === currentSource.current &&
      element.current === video &&
      isActive() &&
      (!video.currentSrc || video.currentSrc === access.access?.url)
    );
  }
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
  async function playPositioned(video: HTMLVideoElement) {
    if (current.current.suspended || resumeRequired.current) return;
    const token = generation.current,
      key = current.current.activationKey;
    try {
      await video.play();
    } catch {
      if (
        token === generation.current &&
        !current.current.suspended &&
        !resumeRequired.current &&
        key === current.current.activationKey &&
        video === element.current
      ) {
        setPlaying(false);
        desired.current.play = false;
        emit("blocked");
      }
    }
  }
  async function play() {
    const video = element.current,
      active = bounds();
    if (
      !video ||
      !active ||
      !isActive() ||
      current.current.suspended ||
      current.current.mode === "decision" ||
      access.invalid ||
      access.error ||
      mediaError
    )
      return;
    resumeRequired.current = false;
    if (running.current.finished) {
      running.current.finished = false;
      running.current.started = false;
      setFinished(false);
      desired.current = { time: active.startSeconds, play: true };
      positionVideo();
      return;
    }
    if (!running.current.positioned) return;
    desired.current.play = true;
    await playPositioned(video);
  }
  function pause() {
    element.current?.pause();
    setPlaying(false);
    desired.current.play = false;
  }
  function exposePosition() {
    const video = element.current;
    if (!video || !isActive() || video.readyState < 1) return;
    const target = safeTime(desired.current.time);
    if (Math.abs(video.currentTime - target) > 0.2) {
      video.currentTime = target;
      return;
    }
    running.current.positioned = true;
    setPositioned(true);
    video.style.visibility = "visible";
    if (
      current.current.suspended ||
      resumeRequired.current ||
      current.current.mode === "decision" ||
      running.current.finished
    ) {
      video.pause();
      setPlaying(false);
    } else if (desired.current.play && !document.hidden)
      void playPositioned(video);
    recovering.current = false;
  }
  function positionVideo() {
    const video = element.current;
    if (!video || video.readyState < 1 || !bounds() || !isActive()) return;
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
    if (
      !video ||
      !active ||
      !isActive() ||
      current.current.suspended ||
      resumeRequired.current ||
      !running.current.positioned ||
      running.current.finished ||
      current.current.mode === "decision" ||
      video.currentTime < active.endSeconds - PAUSE_MARGIN_SECONDS
    )
      return;
    running.current.finished = true;
    setFinished(true);
    video.pause();
    setPlaying(false);
    desired.current.play = false;
    const completedMode = current.current.mode;
    emit("complete");
    const safeEnd = active.endSeconds - PAUSE_MARGIN_SECONDS;
    if (video.currentTime > safeEnd) {
      desired.current.time = safeEnd;
      positionVideo();
    }
    if (completedMode === "setup") current.current.onComplete?.();
  }
  function checkPosition() {
    const video = element.current,
      active = bounds();
    if (!video || !active || !isActive() || !running.current.positioned) return;
    if (current.current.suspended || resumeRequired.current) {
      if (!video.paused) pause();
      return;
    }
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
    if (running.current.key === activationKey) return;
    const prior = running.current.key;
    resumeRequired.current = current.current.suspended;
    generation.current++;
    running.current = {
      key: activationKey,
      finished: mode === "decision",
      positioned: false,
      started: false,
    };
    setFinished(mode === "decision");
    setMediaError(null);
    setPositioned(false);
    recovering.current = false;
    desired.current = {
      time:
        mode === "decision"
          ? setup.endSeconds - PAUSE_MARGIN_SECONDS
          : (segment?.startSeconds ?? 0),
      play:
        mode !== "decision" &&
        !current.current.suspended &&
        (current.current.autoplay ?? (mode !== "setup" || !!prior)),
    };
    positionVideo();
  }, [activationKey, mode, setup.endSeconds, segment?.startSeconds]);
  useEffect(() => {
    if (priorIntent.current === true && autoplay === false) pause();
    priorIntent.current = autoplay;
  }, [autoplay]);
  useEffect(() => {
    if (!suspended) return;
    resumeRequired.current = true;
    // Invalidate a play promise that may settle after the confirmation closes.
    generation.current++;
    pause();
  }, [suspended]);
  useEffect(() => {
    const timer = setInterval(checkPosition, 50);
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      generation.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      element.current?.pause();
    };
  }, []);
  useEffect(() => {
    if (access.error || access.invalid || mediaError) {
      pause();
      emit("error");
    }
  }, [access.error, access.invalid, mediaError]);
  function mediaFailed() {
    pause();
    running.current.positioned = false;
    running.current.started = false;
    setPositioned(false);
    if (element.current) element.current.style.visibility = "hidden";
    if (!recovering.current && !access.invalid) {
      recovering.current = true;
      const token = ++generation.current,
        key = current.current.activationKey;
      void access.refresh().then(() => {
        if (
          token === generation.current &&
          key === current.current.activationKey
        )
          element.current?.load();
      });
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
            onLoadedMetadata={(event) => {
              if (!acceptsEvent(event.currentTarget)) return;
              event.currentTarget.volume = volume;
              positionVideo();
            }}
            onSeeked={(event) => {
              if (acceptsEvent(event.currentTarget)) exposePosition();
            }}
            onSeeking={(event) => {
              const video = event.currentTarget;
              if (!acceptsEvent(video)) return;
              video.style.visibility = "hidden";
              if (running.current.positioned)
                desired.current = {
                  time: safeTime(video.currentTime),
                  play:
                    !video.paused &&
                    !current.current.suspended &&
                    !resumeRequired.current &&
                    current.current.mode !== "decision" &&
                    !running.current.finished,
                };
              running.current.positioned = false;
              setPositioned(false);
            }}
            onTimeUpdate={(event) => {
              if (acceptsEvent(event.currentTarget)) checkPosition();
            }}
            onEnded={(event) => {
              if (acceptsEvent(event.currentTarget)) completeSegment();
            }}
            onError={(event) => {
              if (acceptsEvent(event.currentTarget)) mediaFailed();
            }}
            onPlay={(event) => {
              if (!acceptsEvent(event.currentTarget)) {
                event.currentTarget.pause();
                return;
              }
              if (
                current.current.mode === "decision" ||
                current.current.suspended ||
                resumeRequired.current ||
                document.hidden ||
                !running.current.positioned ||
                running.current.finished
              )
                pause();
              else {
                setPlaying(true);
                if (!running.current.started) {
                  running.current.started = true;
                  emit("started");
                }
              }
            }}
            onPause={(event) => {
              if (acceptsEvent(event.currentTarget)) setPlaying(false);
            }}
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
              disabled={suspended}
              onClick={() => {
                if (current.current.suspended) return;
                setMediaError(null);
                recovering.current = false;
                const key = current.current.activationKey,
                  token = ++generation.current;
                running.current.started = false;
                void access.refresh().then(() => {
                  if (
                    token === generation.current &&
                    key === current.current.activationKey
                  )
                    element.current?.load();
                });
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
            disabled={
              !positioned || mode === "decision" || access.loading || suspended
            }
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
      {!hideCaption && segment?.caption && (
        <p className="media-caption">{segment.caption}</p>
      )}
    </section>
  );
}
