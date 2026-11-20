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
import type { ScenarioPlaybackEvent } from "@/lib/video/playback-events";

type Props = {
  setup: YouTubeSegment;
  reveal?: YouTubeSegment;
  mode: PlaybackMode;
  onComplete?: () => void;
  playbackKey?: string;
  onPlaybackEvent?: (event: ScenarioPlaybackEvent) => void;
  autoplay?: boolean;
  hideCaption?: boolean;
};
type Status = "loading" | "ready" | "playing" | "paused" | "complete";
type Activation = {
  segment: YouTubeSegment;
  mode: PlaybackMode;
  key: string;
  generation: number;
  finished: boolean;
  positioned: boolean;
  started: boolean;
};
export function YouTubeScenarioPlayer({
  setup,
  reveal,
  mode,
  onComplete,
  playbackKey = "legacy",
  onPlaybackEvent,
  autoplay,
  hideCaption = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const current = useRef({
    setup,
    reveal,
    mode,
    onComplete,
    playbackKey,
    onPlaybackEvent,
    autoplay,
  });
  current.current = {
    setup,
    reveal,
    mode,
    onComplete,
    playbackKey,
    onPlaybackEvent,
    autoplay,
  };
  const active = useRef<Activation | null>(null);
  const generation = useRef(0);
  const playbackTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [ready, setReady] = useState(false),
    [status, setStatus] = useState<Status>("loading"),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const [volume, setVolume] = useState(100);
  const userVolume = useRef<number | null>(null);
  const previousMode = useRef<PlaybackMode | null>(null);
  const priorIntent = useRef(autoplay);
  function isCurrent(running: Activation | null): running is Activation {
    return (
      !!running &&
      active.current === running &&
      running.key === current.current.playbackKey &&
      running.mode === current.current.mode
    );
  }
  function emit(type: ScenarioPlaybackEvent["type"], running = active.current) {
    if (isCurrent(running))
      current.current.onPlaybackEvent?.({
        playbackKey: running.key,
        mode: running.mode,
        type,
      });
  }
  function startSegment(
    segment: YouTubeSegment,
    shouldPlay: boolean,
    playbackMode = current.current.mode,
  ) {
    const target = player.current;
    if (!target) return;
    clearTimeout(playbackTimeout.current);
    active.current = {
      segment,
      mode: playbackMode,
      key: current.current.playbackKey,
      generation: ++generation.current,
      finished: false,
      positioned: false,
      started: false,
    };
    setError(null);
    setStatus(shouldPlay ? "loading" : "ready");
    target.getIframe().title = segment.alt;
    const bounds = {
      videoId: segment.videoId,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    };
    if (shouldPlay) target.loadVideoById(bounds);
    else target.cueVideoById(bounds);
  }
  useEffect(() => {
    let disposed = false;
    let created: YouTubePlayer | null = null;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    setReady(false);
    setError(null);
    setStatus("loading");
    previousMode.current = null;
    active.current = null;
    function fail(message: string, running = active.current) {
      if (disposed || (running && !isCurrent(running))) return;
      setError(message);
      if (running) emit("error", running);
      else
        current.current.onPlaybackEvent?.({
          playbackKey: current.current.playbackKey,
          mode: current.current.mode,
          type: "error",
        });
    }
    function finishSegment() {
      const running = active.current,
        target = player.current;
      if (
        disposed ||
        !isCurrent(running) ||
        !running.positioned ||
        running.finished ||
        !target ||
        target.getCurrentTime() <
          running.segment.endSeconds - PAUSE_MARGIN_SECONDS
      )
        return;
      clearTimeout(playbackTimeout.current);
      running.finished = true;
      target.pauseVideo();
      setStatus("complete");
      emit("complete", running);
      if (running.mode === "setup") current.current.onComplete?.();
    }
    function checkPosition() {
      const running = active.current,
        target = player.current;
      if (disposed || !target || !isCurrent(running)) return;
      const time = target.getCurrentTime(),
        playing = target.getPlayerState() === 1;
      if (
        !running.positioned &&
        time >= running.segment.startSeconds - 1 &&
        time <= running.segment.endSeconds + 1
      )
        running.positioned = true;
      if (!running.positioned) return;
      if (
        playing &&
        !running.started &&
        running.mode !== "decision" &&
        !running.finished
      ) {
        running.started = true;
        emit("started", running);
      }
      const instruction = getPlaybackInstruction({
        mode: running.mode,
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
        clearTimeout(playbackTimeout.current);
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
            if (userVolume.current !== null)
              target.setVolume?.(userVolume.current);
            else {
              const initial = target.getVolume?.();
              if (typeof initial === "number" && Number.isFinite(initial))
                setVolume(Math.max(0, Math.min(100, initial)));
            }
            target.getIframe().title = current.current.setup.alt;
            setReady(true);
          },
          onStateChange: ({ data }) => {
            if (disposed) return;
            const running = active.current;
            if (!isCurrent(running)) return;
            if (data !== 3) clearTimeout(playbackTimeout.current);
            if (data === 1) {
              if (document.hidden) {
                handleVisibilityChange();
                return;
              }
              setStatus("playing");
              checkPosition();
            } else if (data === 2)
              setStatus(running.finished ? "complete" : "paused");
            else if (data === 0) finishSegment();
            else if (data === 3) {
              setStatus("loading");
              clearTimeout(playbackTimeout.current);
              playbackTimeout.current = setTimeout(
                () =>
                  fail(
                    "The video is taking too long to load. Your answer is safe; retry playback.",
                    running,
                  ),
                20000,
              );
            }
          },
          onError: ({ data }) => {
            clearTimeout(playbackTimeout.current);
            fail(describeYouTubeError(data));
          },
          onAutoplayBlocked: () => {
            clearTimeout(playbackTimeout.current);
            if (!disposed && isCurrent(active.current)) {
              setStatus("paused");
              emit("blocked");
            }
          },
        });
        readyTimeout = setTimeout(
          () =>
            fail(
              "YouTube didn't become ready. Check your connection and retry the video.",
            ),
          15000,
        );
      })
      .catch((failure: unknown) =>
        fail(
          failure instanceof Error
            ? failure.message
            : "The video couldn't load. Please retry.",
        ),
      );
    const timer = setInterval(checkPosition, 75);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(readyTimeout);
      clearTimeout(playbackTimeout.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      created?.destroy();
      player.current = null;
      active.current = null;
    };
  }, [setup.videoId, attempt]);
  useEffect(() => {
    if (!ready || !player.current) return;
    clearTimeout(playbackTimeout.current);
    const prior = previousMode.current;
    previousMode.current = mode;
    if (mode === "decision") {
      const previous = active.current;
      active.current = {
        segment: setup,
        mode,
        key: playbackKey,
        generation: ++generation.current,
        finished: true,
        positioned: previous?.positioned ?? false,
        started: false,
      };
      player.current.pauseVideo();
      setStatus("paused");
      if (!previous) {
        const restore = {
          ...setup,
          startSeconds: Math.max(setup.startSeconds, setup.endSeconds - 1),
        };
        active.current.segment = restore;
        player.current.loadVideoById({
          videoId: setup.videoId,
          startSeconds: restore.startSeconds,
          endSeconds: setup.endSeconds,
        });
      }
      return;
    }
    const segment =
      mode === "reveal" ? current.current.reveal : current.current.setup;
    if (segment)
      startSegment(
        segment,
        current.current.autoplay ?? (mode !== "setup" || prior !== null),
        mode,
      );
  }, [
    mode,
    ready,
    playbackKey,
    setup.videoId,
    setup.startSeconds,
    setup.endSeconds,
    reveal?.videoId,
    reveal?.startSeconds,
    reveal?.endSeconds,
  ]);
  useEffect(() => {
    if (priorIntent.current === true && autoplay === false) {
      clearTimeout(playbackTimeout.current);
      player.current?.pauseVideo();
      setStatus(active.current?.finished ? "complete" : "paused");
    }
    priorIntent.current = autoplay;
  }, [autoplay]);
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
    clearTimeout(playbackTimeout.current);
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
          <label className="volume-control">
            Volume
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={volume}
              disabled={!ready}
              onChange={(event) => {
                const next = Number(event.target.value);
                userVolume.current = next;
                setVolume(next);
                player.current?.setVolume?.(next);
              }}
            />
          </label>
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
      {!hideCaption && (continuation ? reveal?.caption : setup.caption) && (
        <p className="media-caption">
          {continuation ? reveal?.caption : setup.caption}
        </p>
      )}
    </section>
  );
}
