import type { PlaybackMode } from "./segment-controller";

/** Presentation events only; media authorization remains on the server. */
export type ScenarioPlaybackEvent = {
  playbackKey: string;
  mode: PlaybackMode;
  type: "started" | "complete" | "blocked" | "error";
};

export type ScenarioPlaybackStatus =
  "idle" | "playing" | "complete" | "blocked" | "error";

export function isCurrentPlaybackEvent(
  event: ScenarioPlaybackEvent,
  expected: { playbackKey: string; mode: PlaybackMode },
): boolean {
  return (
    event.playbackKey === expected.playbackKey && event.mode === expected.mode
  );
}
