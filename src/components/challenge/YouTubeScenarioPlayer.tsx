"use client";

import { useEffect, useRef, useState } from "react";
import type { YouTubeSegment } from "@/contracts/challenge";
import {
  createYouTubePlayer,
  describeYouTubeError,
  loadYouTubeApi,
  type YouTubePlayer,
} from "@/lib/video/youtube-api";
import {
  getPlaybackInstruction,
  PAUSE_MARGIN_SECONDS,
  type PlaybackMode,
} from "@/lib/video/segment-controller";

type Props = {
  setup: YouTubeSegment;
  reveal?: YouTubeSegment;
  mode: PlaybackMode;
  onComplete?: () => void;
};
type Status = "loading" | "ready" | "playing" | "paused" | "complete";

export function YouTubeScenarioPlayer({
  setup,
  reveal,
  mode,
  onComplete,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const current = useRef({ setup, reveal, mode, onComplete });
  current.current = { setup, reveal, mode, onComplete };
  const active = useRef<{
    segment: YouTubeSegment;
    mode: PlaybackMode;
    finished: boolean;
    positioned: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const previousMode = useRef<PlaybackMode | null>(null);

  function startSegment(
    segment: YouTubeSegment,
    autoplay: boolean,
    playbackMode = current.current.mode,
  ) {
    const target = player.current;
    if (!target) return;
    active.current = {
      segment,
      mode: playbackMode,
      finished: false,
      positioned: false,
    };
    setStatus(autoplay ? "loading" : "ready");
    const bounds = {
      videoId: segment.videoId,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    };
    if (autoplay) target.loadVideoById(bounds);
    else target.cueVideoById(bounds);
  }

  useEffect(() => {
    let disposed = false;
    let created: YouTubePlayer | null = null;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    let playbackTimeout: ReturnType<typeof setTimeout> | undefined;
    setReady(false);
    setError(null);
    setStatus("loading");
    previousMode.current = null;
    active.current = null;

    function finishSegment() {
      const running = active.current;
      if (!running || running.finished || !player.current) return;
      clearTimeout(playbackTimeout);
      running.finished = true;
      player.current.pauseVideo();
      setStatus("complete");
      if (running.mode === "setup" && current.current.mode === "setup")
        current.current.onComplete?.();
    }
    function checkPosition() {
      if (disposed || !player.current || !active.current) return;
      const target = player.current;
      const running = active.current;
      const time = target.getCurrentTime();
      const playing = target.getPlayerState() === 1;
      // Ignore stale provider time while a new segment is being loaded.
      if (
        !running.positioned &&
        time >= running.segment.startSeconds - 1 &&
        time <= running.segment.endSeconds + 1
      )
        running.positioned = true;
      if (!running.positioned) return;
      const instruction = getPlaybackInstruction({
        mode: current.current.mode,
        segment: running.segment,
        currentTime: time,
        playing,
        finished: running.finished,
      });
      if (instruction === "complete") finishSegment();
      else if (instruction === "pause") {
        target.pauseVideo();
        if (time > running.segment.endSeconds)
          target.seekTo(
            running.segment.endSeconds - PAUSE_MARGIN_SECONDS,
            true,
          );
        setStatus("paused");
      } else if (instruction === "restart")
        startSegment(running.segment, true, running.mode);
    }
    function handleVisibilityChange() {
      if (document.hidden && player.current) {
        clearTimeout(playbackTimeout);
        player.current.pauseVideo();
        setStatus("paused");
      }
    }

    void loadYouTubeApi()
      .then((api) => {
        if (disposed || !host.current) return;
        const mount = document.createElement("div");
        host.current.replaceChildren(mount);
        created = createYouTubePlayer(api, mount, current.current.setup, {
          onReady: ({ target }) => {
            if (disposed) return;
            clearTimeout(readyTimeout);
            player.current = target;
            target.getIframe().title = current.current.setup.alt;
            setReady(true);
          },
          onStateChange: ({ data }) => {
            if (disposed) return;
            if (data !== 3) clearTimeout(playbackTimeout);
            if (data === 1) {
              if (document.hidden) {
                handleVisibilityChange();
                return;
              }
              setStatus("playing");
              checkPosition();
            } else if (data === 2)
              setStatus(active.current?.finished ? "complete" : "paused");
            else if (
              data === 0 &&
              active.current?.positioned &&
              player.current &&
              player.current.getCurrentTime() >=
                active.current.segment.endSeconds - PAUSE_MARGIN_SECONDS
            )
              finishSegment();
            else if (data === 3) {
              setStatus("loading");
              clearTimeout(playbackTimeout);
              playbackTimeout = setTimeout(() => {
                if (!disposed)
                  setError(
                    "The video is taking too long to load. Your answer is safe; retry playback.",
                  );
              }, 20000);
            }
          },
          onError: ({ data }) => {
            clearTimeout(playbackTimeout);
            if (!disposed) setError(describeYouTubeError(data));
          },
          onAutoplayBlocked: () => {
            clearTimeout(playbackTimeout);
            if (!disposed) setStatus("paused");
          },
        });
        readyTimeout = setTimeout(() => {
          if (!disposed)
            setError(
              "YouTube didn't become ready. Check your connection and retry the video.",
            );
        }, 15000);
      })
      .catch((failure: unknown) => {
        if (!disposed)
          setError(
            failure instanceof Error
              ? failure.message
              : "The video couldn't load. Please retry.",
          );
      });
    const timer = setInterval(checkPosition, 75);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(readyTimeout);
      clearTimeout(playbackTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      created?.destroy();
      player.current = null;
      active.current = null;
    };
  }, [setup.videoId, attempt]);

  useEffect(() => {
    if (!ready || !player.current) return;
    const prior = previousMode.current;
    previousMode.current = mode;
    if (mode === "decision") {
      player.current.pauseVideo();
      setStatus("paused");
      // A retry in the decision phase restores the last safe source position.
      if (!active.current) {
        const restore = {
          ...setup,
          startSeconds: Math.max(setup.startSeconds, setup.endSeconds - 1),
        };
        active.current = {
          segment: restore,
          mode: "decision",
          finished: true,
          positioned: false,
        };
        player.current.loadVideoById({
          videoId: setup.videoId,
          startSeconds: restore.startSeconds,
          endSeconds: setup.endSeconds,
        });
      }
      return;
    }
    const segment = mode === "reveal" ? reveal : setup;
    if (!segment) return;
    startSegment(segment, mode !== "setup" || prior !== null, mode);
  }, [mode, ready, setup, reveal]);

  useEffect(() => {
    if (error) player.current?.pauseVideo();
  }, [error]);

  function play() {
    if (!player.current || mode === "decision") return;
    const segment = mode === "reveal" ? reveal : setup;
    if (!segment) return;
    if (active.current?.finished) startSegment(segment, true);
    else {
      player.current.playVideo();
      setStatus("loading");
    }
  }
  function pause() {
    player.current?.pauseVideo();
    setStatus("paused");
  }
  const continuation = mode === "reveal";
  const label = continuation
    ? "Pro continuation"
    : mode === "decision"
      ? "Decision paused"
      : "Watch the setup";

  return (
    <section className="media-card youtube-card" aria-label={label}>
      <div className="media-topline">
        <span>
          <i className="live-dot" />
          {label}
        </span>
        <span className="mono">PLAYER POV</span>
      </div>
      <div className="youtube-viewport" ref={host} />
      {error ? (
        <div className="video-message" role="alert">
          <p>{error}</p>
          <button
            className="button button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry video
          </button>
        </div>
      ) : (
        <div className="video-controls">
          <p role="status" aria-live="polite">
            {mode === "decision"
              ? "Paused for your decision. Choose below to reveal what happened."
              : !ready
                ? "Connecting to YouTube…"
                : status === "complete"
                  ? continuation
                    ? "Continuation complete. Review the analysis below."
                    : "Setup complete."
                  : status === "playing"
                    ? continuation
                      ? "Watching the pro's action…"
                      : "Watch closely. The video will pause for your decision."
                    : status === "loading"
                      ? "Loading video… If it doesn't start, press Play."
                      : "Press Play when you're ready."}
          </p>
          {mode !== "decision" && (
            <button
              className="button button-secondary"
              disabled={!ready}
              onClick={status === "playing" ? pause : play}
            >
              {status === "playing"
                ? "Pause video"
                : status === "complete"
                  ? continuation
                    ? "Replay continuation"
                    : "Replay setup"
                  : continuation
                    ? "Play continuation"
                    : "Play setup"}
            </button>
          )}
        </div>
      )}
      {setup.caption && (
        <p className="media-caption">
          {continuation ? reveal?.caption : setup.caption}
        </p>
      )}
    </section>
  );
}
