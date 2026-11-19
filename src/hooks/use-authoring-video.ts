"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreatorDraftContent } from "@/contracts/creator";
import { parseYouTubeSource } from "@/lib/creator/content";
import {
  createYouTubePlayer,
  describeYouTubeError,
  loadYouTubeApi,
  type YouTubePlayer,
} from "@/lib/video/youtube-api";
import { useUploadedPlayback } from "./use-uploaded-playback";

export function useAuthoringVideo(source: CreatorDraftContent["source"]) {
  const nativeRef = useRef<HTMLVideoElement>(null),
    youtubeHost = useRef<HTMLDivElement>(null),
    youtube = useRef<YouTubePlayer | null>(null);
  const nativeElementRef = useCallback((video: HTMLVideoElement | null) => {
    if (nativeRef.current && nativeRef.current !== video)
      nativeRef.current.pause();
    nativeRef.current = video;
  }, []);
  const uploaded = source.kind === "uploaded";
  const assetId = uploaded ? source.assetId : null;
  const videoId = !uploaded
    ? (parseYouTubeSource(source.url)?.videoId ?? null)
    : null;
  const identity = uploaded
    ? `upload:${assetId ?? ""}`
    : `youtube:${videoId ?? ""}`;
  const [ready, setReady] = useState(false),
    [playing, setPlaying] = useState(false),
    [seeking, setSeeking] = useState(false);
  const [time, setTime] = useState(0),
    [duration, setDuration] = useState<number | null>(null),
    [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0),
    [volume, setVolume] = useState(1);
  const seekingTo = useRef<number | null>(null);
  const playIntent = useRef(false);
  const restore = useRef({ time: 0, play: false });
  const generation = useRef(0);
  const access = useUploadedPlayback(
    assetId ? { kind: "creator-asset", assetId } : null,
    assetId,
    () => {
      if (nativeRef.current && ready)
        restore.current = {
          time: nativeRef.current.currentTime,
          play: !nativeRef.current.paused,
        };
      setReady(false);
      if (nativeRef.current) {
        nativeRef.current.pause();
        nativeRef.current.style.visibility = "hidden";
      }
    },
  );
  const readTime = () =>
    uploaded
      ? (nativeRef.current?.currentTime ?? NaN)
      : (youtube.current?.getCurrentTime() ?? NaN);
  function pause() {
    playIntent.current = false;
    nativeRef.current?.pause();
    youtube.current?.pauseVideo();
    restore.current.play = false;
    setPlaying(false);
  }
  function seek(value: number) {
    if (!ready || duration === null || !Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(duration, value));
    seekingTo.current = next;
    setSeeking(true);
    setTime(next);
    if (uploaded && nativeRef.current) {
      if (Math.abs(nativeRef.current.currentTime - next) < 0.01) {
        seekingTo.current = null;
        setSeeking(false);
      } else nativeRef.current.currentTime = next;
    } else youtube.current?.seekTo(next, true);
  }
  async function play() {
    if (!ready || seeking || access.invalid) return;
    playIntent.current = true;
    try {
      if (uploaded) await nativeRef.current?.play();
      else youtube.current?.playVideo();
    } catch {
      playIntent.current = false;
      setPlaying(false);
    }
  }
  function setPlayerVolume(value: number) {
    setVolume(value);
    if (nativeRef.current) nativeRef.current.volume = value;
    youtube.current?.setVolume?.(value * 100);
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setReady(false);
    setPlaying(false);
    setSeeking(false);
    setTime(0);
    setDuration(null);
    setError(null);
    restore.current = { time: 0, play: false };
    playIntent.current = false;
    seekingTo.current = null;
    let disposed = false,
      created: YouTubePlayer | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const observe = () => {
      if (disposed || epoch !== generation.current || !youtube.current) return;
      const target = youtube.current,
        seconds = target.getCurrentTime(),
        length = target.getDuration?.();
      if (Number.isFinite(length) && length! > 0) {
        setDuration(length!);
        setReady(true);
        clearTimeout(timeout);
      }
      if (Number.isFinite(seconds)) setTime(seconds);
      if (target.getPlayerState() === 1 && !playIntent.current) {
        target.pauseVideo();
        setPlaying(false);
      } else setPlaying(target.getPlayerState() === 1);
      if (
        seekingTo.current !== null &&
        Math.abs(seconds - seekingTo.current) < 0.4 &&
        target.getPlayerState() !== 3
      ) {
        seekingTo.current = null;
        setSeeking(false);
      }
    };
    if (!uploaded && videoId) {
      void loadYouTubeApi()
        .then((api) => {
          if (disposed || !youtubeHost.current) return;
          const mount = document.createElement("div");
          youtubeHost.current.replaceChildren(mount);
          created = createYouTubePlayer(
            api,
            mount,
            { videoId, startSeconds: 0, endSeconds: 43200 },
            {
              onReady: ({ target }) => {
                if (disposed) return;
                youtube.current = target;
                target.getIframe().title = "Source recording for manual timing";
                target.cueVideoById({
                  videoId,
                  startSeconds: 0,
                  endSeconds: 43200,
                });
                observe();
              },
              onStateChange: observe,
              onAutoplayBlocked: () => {
                if (!disposed) {
                  playIntent.current = false;
                  setPlaying(false);
                }
              },
              onError: ({ data }) => {
                if (!disposed) {
                  setError(describeYouTubeError(data));
                  setReady(false);
                }
              },
            },
          );
          timeout = setTimeout(() => {
            if (!disposed)
              setError(
                "The source player did not become ready. Retry playback.",
              );
          }, 20000);
        })
        .catch((failure) => {
          if (!disposed)
            setError(
              failure instanceof Error
                ? failure.message
                : "The source player could not load.",
            );
        });
    }
    const poll = setInterval(observe, 200);
    const hide = () => {
      if (document.hidden) pause();
    };
    const invalidate = () => {
      pause();
      setReady(false);
      setError("Your session changed. Sign in again to edit this recording.");
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      disposed = true;
      clearInterval(poll);
      clearTimeout(timeout);
      created?.destroy();
      youtube.current = null;
      nativeRef.current?.pause();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [identity, attempt]);
  function nativeReady() {
    const target = nativeRef.current;
    if (!target || !Number.isFinite(target.duration) || target.duration <= 0) {
      setError("This recording has no usable duration.");
      return;
    }
    setDuration(target.duration);
    target.volume = volume;
    const position = Math.min(restore.current.time, target.duration);
    if (Math.abs(target.currentTime - position) > 0.01) {
      seekingTo.current = position;
      setSeeking(true);
      target.currentTime = position;
    } else nativeSeeked();
  }
  function nativeSeeked() {
    const target = nativeRef.current;
    if (!target) return;
    setTime(target.currentTime);
    setReady(true);
    setSeeking(false);
    seekingTo.current = null;
    target.style.visibility = "visible";
    if (restore.current.play && !document.hidden) {
      restore.current.play = false;
      playIntent.current = true;
      void target.play().catch(() => {
        playIntent.current = false;
        setPlaying(false);
      });
    }
  }
  return {
    nativeRef,
    nativeElementRef,
    youtubeHost,
    uploaded,
    hasSource: !!(assetId || videoId),
    sourceUrl:
      access.access?.assetId === assetId ? access.access.url : undefined,
    ready: ready && !access.invalid && !access.error && !error,
    playing,
    seeking,
    time,
    duration,
    volume,
    error: error ?? access.error,
    play,
    pause,
    seek,
    readTime,
    setVolume: setPlayerVolume,
    retry: () => {
      setError(null);
      if (uploaded) {
        restore.current = {
          time: nativeRef.current?.currentTime ?? time,
          play: false,
        };
        void access.refresh().then(() => nativeRef.current?.load());
      } else setAttempt((n) => n + 1);
    },
    nativeHandlers: {
      onLoadedMetadata: nativeReady,
      onSeeked: nativeSeeked,
      onSeeking: () => setSeeking(true),
      onTimeUpdate: () => {
        if (nativeRef.current) setTime(nativeRef.current.currentTime);
      },
      onPlay: () => {
        if (!playIntent.current || document.hidden || access.invalid) pause();
        else setPlaying(true);
      },
      onPause: () => setPlaying(false),
      onError: () => {
        pause();
        setReady(false);
        setError("The recording could not play. Retry playback.");
      },
    },
  };
}
