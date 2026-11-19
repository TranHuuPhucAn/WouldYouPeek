"use client";
import type { CreatorDraftContent, ValidationIssue } from "@/contracts/creator";
import { SelectField, TextField } from "./EditorFields";
import { parseYouTubeSource } from "@/lib/creator/content";
export function SourceFields({
  source,
  onChange,
  issues,
}: {
  source: CreatorDraftContent["source"];
  onChange: (source: CreatorDraftContent["source"]) => void;
  issues: ValidationIssue[];
}) {
  const updateSourceField = <K extends keyof typeof source>(
    key: K,
    value: (typeof source)[K],
  ) => onChange({ ...source, [key]: value });
  const parsedSource = source.url.trim()
    ? parseYouTubeSource(source.url.trim())
    : null;
  return (
    <fieldset className="creator-section">
      <legend>01 · Source and round</legend>
      <p>
        Use a player’s own information. Credit the recording and enter its
        context; metadata is not fetched automatically.
      </p>
      <TextField
        path="source.url"
        label="YouTube URL"
        value={source.url}
        onChange={(value) => updateSourceField("url", value)}
        maxLength={2048}
        issues={issues}
        placeholder="https://www.youtube.com/watch?v=…"
        hint="YouTube watch or youtu.be link. Timestamps are entered separately below."
      />
      {source.url.trim() && (
        <p className="quiet-note" role="status">
          {parsedSource
            ? "Recognized YouTube link. Source credit remains yours to check."
            : "This link is not supported for publication. You can still save the draft and replace it later."}
        </p>
      )}
      <div className="creator-field-grid">
        {(
          [
            ["title", "Source video title"],
            ["uploader", "Channel / uploader"],
            ["player", "Player"],
            ["map", "Map"],
            ["agent", "Agent"],
            ["score", "Score before the round"],
          ] as const
        ).map(([key, label]) => (
          <TextField
            key={key}
            path={`source.${key}`}
            label={label}
            value={source[key]}
            onChange={(value) => updateSourceField(key, value)}
            maxLength={300}
            issues={issues}
            placeholder={key === "score" ? "5-5" : undefined}
          />
        ))}
        <SelectField
          path="source.matchType"
          label="Match type"
          value={source.matchType ?? ""}
          onChange={(value) =>
            updateSourceField(
              "matchType",
              (value as typeof source.matchType) || null,
            )
          }
          choices={[
            { value: "", label: "Choose match type" },
            { value: "ranked", label: "Ranked" },
            { value: "tournament", label: "Tournament" },
          ]}
          issues={issues}
        />
        <SelectField
          path="source.side"
          label="Player’s side"
          value={source.side ?? ""}
          onChange={(value) =>
            updateSourceField("side", (value as typeof source.side) || null)
          }
          choices={[
            { value: "", label: "Choose side" },
            { value: "attack", label: "Attack" },
            { value: "defense", label: "Defense" },
          ]}
          issues={issues}
        />
        <TextField
          path="source.round"
          label="Round number"
          value={source.round === null ? "" : String(source.round)}
          onChange={(value) =>
            updateSourceField("round", value === "" ? null : Number(value))
          }
          maxLength={3}
          type="number"
          issues={issues}
        />
        <TextField
          path="source.publishedDate"
          label="Source date (optional)"
          value={source.publishedDate}
          onChange={(value) => updateSourceField("publishedDate", value)}
          maxLength={10}
          type="date"
          issues={issues}
        />
        <TextField
          path="source.dateNote"
          label="Source date note (optional)"
          value={source.dateNote}
          onChange={(value) => updateSourceField("dateNote", value)}
          maxLength={300}
          issues={issues}
        />
      </div>
    </fieldset>
  );
}
