"use client";
import type { CreatorDraftContent, ValidationIssue } from "@/contracts/creator";
import { getTimingSummary } from "@/lib/creator/timestamps";
import type { TimingField, TimingState } from "@/lib/creator/timing-state";
import { TextField } from "./EditorFields";
const times = [
  ["startSeconds", "Setup starts"],
  ["decisionSeconds", "Decision pause"],
  ["endSeconds", "Continuation ends"],
] as const;
export function TimingFields({
  media,
  onChange,
  issues,
  raw,
  onTimeChange,
}: {
  media: CreatorDraftContent["media"];
  onChange: (media: CreatorDraftContent["media"]) => void;
  issues: ValidationIssue[];
  raw: TimingState;
  onTimeChange: (field: TimingField, text: string) => void;
}) {
  const durations = getTimingSummary(media);
  return (
    <fieldset className="creator-section">
      <legend>02 · The decision window</legend>
      <p>
        Setup stops at the decision. The continuation starts at that same moment
        after the learner commits.
      </p>
      <div className="creator-field-grid">
        {times.map(([key, label]) => (
          <TextField
            key={key}
            path={`media.${key}`}
            label={label}
            value={raw[key]}
            onChange={(value) => onTimeChange(key, value)}
            issues={issues}
            maxLength={16}
            hint="Seconds, mm:ss or hh:mm:ss. Up to 3 decimal places."
          />
        ))}
      </div>
      <p className="timing-summary">
        Setup: {durations.setup === null ? "—" : `${durations.setup}s`} ·
        Continuation:{" "}
        {durations.continuation === null ? "—" : `${durations.continuation}s`}.
        Use 2–120 seconds of setup and 1–120 seconds of continuation.
      </p>
      <div className="creator-field-grid">
        {(
          [
            ["setupAlt", "Setup description"],
            ["decisionAlt", "Paused moment description"],
            ["revealAlt", "Continuation description"],
          ] as const
        ).map(([key, label]) => (
          <TextField
            key={key}
            path={`media.${key}`}
            label={label}
            value={media[key]}
            onChange={(value) => onChange({ ...media, [key]: value })}
            maxLength={300}
            issues={issues}
          />
        ))}
      </div>
    </fieldset>
  );
}
