export type SegmentBounds = { startSeconds: number; endSeconds: number };
export type PlaybackMode = "setup" | "decision" | "reveal" | "review-setup";
export const PAUSE_MARGIN_SECONDS = 0.3;

export function validateSegment(segment: SegmentBounds): boolean {
  return (
    Number.isFinite(segment.startSeconds) &&
    Number.isFinite(segment.endSeconds) &&
    segment.startSeconds >= 0 &&
    segment.endSeconds - segment.startSeconds > PAUSE_MARGIN_SECONDS
  );
}

/** Provider state is observed externally; this function only chooses an action. */
export function getPlaybackInstruction(input: {
  mode: PlaybackMode;
  segment: SegmentBounds;
  currentTime: number;
  playing: boolean;
  finished: boolean;
}): "continue" | "pause" | "complete" | "restart" {
  if (!validateSegment(input.segment) || !Number.isFinite(input.currentTime))
    return "pause";
  if (input.mode === "decision" || input.finished)
    return input.playing ? "pause" : "continue";
  if (input.currentTime >= input.segment.endSeconds - PAUSE_MARGIN_SECONDS)
    return "complete";
  if (input.playing && input.currentTime < input.segment.startSeconds - 1)
    return "restart";
  return "continue";
}
