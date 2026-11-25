import type { CreatorDraftContent, ValidationIssue } from "@/contracts/creator";
import { formatTimestampInput, parseTimestampInput } from "./timestamps";

export const timingFields = [
  "startSeconds",
  "decisionSeconds",
  "endSeconds",
] as const;
export type TimingField = (typeof timingFields)[number];
export type TimingState = Record<TimingField, string>;

export function createTimingState(
  media: CreatorDraftContent["media"],
): TimingState {
  return Object.fromEntries(
    timingFields.map((key) => [key, formatTimestampInput(media[key])]),
  ) as TimingState;
}

export function applyTypedTime(
  state: TimingState,
  field: TimingField,
  text: string,
): TimingState {
  return { ...state, [field]: text };
}

export function applyMarkedTime(
  state: TimingState,
  field: TimingField,
  seconds: number,
): TimingState {
  if (!Number.isFinite(seconds) || seconds < 0) return state;
  return {
    ...state,
    [field]: formatTimestampInput(Math.round(seconds * 1000) / 1000),
  };
}

export function timingInputIssues(
  state: TimingState,
  duration: number | null = null,
): ValidationIssue[] {
  return timingFields.flatMap((field) => {
    const result = parseTimestampInput(state[field]);
    if (result.error)
      return [
        {
          path: `media.${field}`,
          code: "TIMESTAMP_FORMAT",
          message: result.error,
        },
      ];
    if (
      duration !== null &&
      Number.isFinite(duration) &&
      result.value !== null &&
      result.value > duration
    )
      return [
        {
          path: `media.${field}`,
          code: "TIMESTAMP_DURATION",
          message: "This timestamp is beyond the recording's duration.",
        },
      ];
    return [];
  });
}

export function applyTimingValues(
  state: TimingState,
  media: CreatorDraftContent["media"],
): CreatorDraftContent["media"] {
  const next = { ...media };
  for (const field of timingFields) {
    const result = parseTimestampInput(state[field]);
    if (!result.error) next[field] = result.value;
  }
  return next;
}
