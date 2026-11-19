"use client";
import type { CreatorDraftContent, ValidationIssue } from "@/contracts/creator";
import { ListField, SelectField, TextField } from "./EditorFields";
export function AnalysisFields({
  content,
  onChange,
  issues,
}: {
  content: CreatorDraftContent;
  onChange: (content: CreatorDraftContent) => void;
  issues: ValidationIssue[];
}) {
  return (
    <fieldset className="creator-section">
      <legend>05 · Observation and analysis</legend>
      <p>
        Separate what happened from why you think it happened. A successful
        outcome does not settle decision quality.
      </p>
      <SelectField
        path="observedAction.optionId"
        label="Observed pro choice"
        value={content.observedAction.optionId ?? ""}
        onChange={(optionId) =>
          onChange({
            ...content,
            observedAction: {
              ...content.observedAction,
              optionId: optionId || null,
            },
          })
        }
        choices={[
          { value: "", label: "Choose the observed action" },
          ...content.options.map((option, index) => ({
            value: option.id,
            label: option.label || `Choice ${index + 1}`,
          })),
        ]}
        issues={issues}
      />
      <TextField
        path="observedAction.description"
        label="What the pro actually did"
        value={content.observedAction.description}
        onChange={(description) =>
          onChange({
            ...content,
            observedAction: { ...content.observedAction, description },
          })
        }
        multiline
        issues={issues}
      />
      <SelectField
        path="analysis.author"
        label="Analysis authorship"
        value={content.analysis.author}
        onChange={(author) =>
          onChange({
            ...content,
            analysis: {
              ...content.analysis,
              author: author as typeof content.analysis.author,
            },
          })
        }
        choices={[
          { value: "creator", label: "Written by me" },
          {
            value: "ai-assisted",
            label: "Written with AI assistance and reviewed by me",
          },
        ]}
        issues={issues}
      />
      <TextField
        path="analysis.rationale"
        label="Reasoning and assumptions"
        value={content.analysis.rationale}
        onChange={(rationale) =>
          onChange({ ...content, analysis: { ...content.analysis, rationale } })
        }
        multiline
        maxLength={4000}
        issues={issues}
      />
      <ListField
        path="analysis.limitations"
        label="Analysis limitations"
        value={content.analysis.limitations}
        onChange={(limitations) =>
          onChange({
            ...content,
            analysis: { ...content.analysis, limitations },
          })
        }
        issues={issues}
      />
      <TextField
        path="takeaway"
        label="Learning takeaway"
        value={content.takeaway}
        onChange={(takeaway) => onChange({ ...content, takeaway })}
        multiline
        issues={issues}
      />
      <TextField
        path="outcomeText"
        label="Recorded outcome"
        value={content.outcomeText}
        onChange={(outcomeText) => onChange({ ...content, outcomeText })}
        multiline
        issues={issues}
      />
    </fieldset>
  );
}
