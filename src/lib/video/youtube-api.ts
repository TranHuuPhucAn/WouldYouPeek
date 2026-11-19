export type VideoBounds = {
  videoId: string;
  startSeconds: number;
  endSeconds: number;
};
export type YouTubePlayer = {
  cueVideoById(bounds: VideoBounds): void;
  loadVideoById(bounds: VideoBounds): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration?(): number;
  getVolume?(): number;
  setVolume?(volume: number): void;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
};
export type YouTubeEvents = {
  onReady(event: { target: YouTubePlayer }): void;
  onStateChange(event: { target: YouTubePlayer; data: number }): void;
  onError(event: { target: YouTubePlayer; data: number }): void;
  onAutoplayBlocked(event: { target: YouTubePlayer }): void;
};
export type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: YouTubeEvents;
    },
  ) => YouTubePlayer;
};
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YouTubeApi> | null = null;

/** Shares the provider script across players; a failed load can be retried. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (typeof window === "undefined")
    return Promise.reject(new Error("Video playback needs a browser."));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.peekYoutubeApi = "true";
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready)
        window.onYouTubeIframeAPIReady = previous;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      pending = null;
      reject(
        new Error(
          "YouTube couldn't connect. Check your connection and retry the video.",
        ),
      );
    };
    const ready = () => {
      try {
        previous?.();
      } catch {
        /* Another consumer must not prevent our player loading. */
      }
      if (settled || !window.YT?.Player) return;
      settled = true;
      cleanup();
      resolve(window.YT);
    };
    const timeout = window.setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = ready;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return pending;
}

export function createYouTubePlayer(
  api: YouTubeApi,
  element: HTMLElement,
  bounds: VideoBounds,
  events: YouTubeEvents,
) {
  return new api.Player(element, {
    videoId: bounds.videoId,
    width: "100%",
    height: "100%",
    playerVars: {
      autoplay: 0,
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      rel: 0,
      start: Math.floor(bounds.startSeconds),
      origin: window.location.origin,
    },
    events,
  });
}

export function describeYouTubeError(code: number): string {
  if (code === 100)
    return "This source video is no longer available on YouTube.";
  if (code === 101 || code === 150)
    return "The source owner has disabled playback on other websites.";
  if (code === 153)
    return "YouTube couldn't identify this website. Try reloading the page in a regular browser.";
  if (code === 2) return "This video segment couldn't be loaded. Please retry.";
  return "YouTube couldn't play this video. Check your connection and retry.";
}
