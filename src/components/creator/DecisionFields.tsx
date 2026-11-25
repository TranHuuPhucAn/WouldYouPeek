"use client";
import type { CreatorDraftContent, ValidationIssue } from "@/contracts/creator";
import { fieldId, ListField, SelectField, TextField } from "./EditorFields";
type Props = {
  content: CreatorDraftContent;
  onChange: (content: CreatorDraftContent) => void;
  issues: ValidationIssue[];
};
export function DecisionFields({ content, onChange, issues }: Props) {
  function updateOption(
    id: string,
    patch: Partial<CreatorDraftContent["options"][number]>,
  ) {
    onChange({
      ...content,
      options: content.options.map((option) =>
        option.id === id ? { ...option, ...patch } : option,
      ),
    });
  }
  function addOption() {
    if (content.options.length < 5)
      onChange({
        ...content,
        options: [
          ...content.options,
          {
            id: crypto.randomUUID(),
            label: "",
            assessment: null,
            explanation: "",
            acceptableWhen: [],
            risks: [],
          },
        ],
      });
  }
  function removeOption(id: string) {
    onChange({
      ...content,
      options: content.options.filter((option) => option.id !== id),
      observedAction:
        content.observedAction.optionId === id
          ? { ...content.observedAction, optionId: null }
          : content.observedAction,
    });
  }
  function moveOption(id: string, direction: number) {
    const options = [...content.options],
      index = options.findIndex((option) => option.id === id),
      next = index + direction;
    if (index < 0 || next < 0 || next >= options.length) return;
    [options[index], options[next]] = [options[next], options[index]];
    onChange({ ...content, options });
  }
  return (
    <>
      <fieldset className="creator-section">
        <legend>03 · Read the moment</legend>
        <div className="creator-field-grid">
          <TextField
            path="title"
            label="Scenario title"
            value={content.title}
            onChange={(title) => onChange({ ...content, title })}
            maxLength={120}
            issues={issues}
          />
          <TextField
            path="topic"
            label="Training topic"
            value={content.topic}
            onChange={(topic) => onChange({ ...content, topic })}
            maxLength={80}
            issues={issues}
            placeholder="Utility timing"
          />
        </div>
        <TextField
          path="context"
          label="Player-visible context"
          value={content.context}
          onChange={(context) => onChange({ ...content, context })}
          maxLength={4000}
          multiline
          issues={issues}
          hint="Describe only information available before the pause."
        />
        <TextField
          path="question"
          label="Decision question"
          value={content.question}
          onChange={(question) => onChange({ ...content, question })}
          multiline
          issues={issues}
        />
        <div className="creator-field-grid">
          <ListField
            path="knownFacts"
            label="Known facts"
            value={content.knownFacts}
            onChange={(knownFacts) => onChange({ ...content, knownFacts })}
            hint="One fact per line. Up to 10 facts, 300 characters each. Add at least one player-visible fact before review or publication. You can save an incomplete draft without one."
            issues={issues}
          />
          <ListField
            path="unknowns"
            label="Unknown information"
            value={content.unknowns}
            onChange={(unknowns) => onChange({ ...content, unknowns })}
            issues={issues}
          />
        </div>
      </fieldset>
      <fieldset
        className="creator-section"
        id={fieldId("options")}
        tabIndex={-1}
      >
        <legend>04 · Choices and alternatives</legend>
        <p>
          Publish with two to five choices. Assess each independently; the pro’s
          choice need not be the preferred one.
        </p>
        {content.options.map((option, index) => (
          <section
            className="creator-option"
            key={option.id}
            aria-label={`Choice ${index + 1}`}
          >
            <div className="creator-option-heading">
              <h3>Choice {index + 1}</h3>
              <div className="creator-option-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={index === 0}
                  onClick={() => moveOption(option.id, -1)}
                  aria-label={`Move choice ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={index === content.options.length - 1}
                  onClick={() => moveOption(option.id, 1)}
                  aria-label={`Move choice ${index + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => removeOption(option.id)}
                >
                  Remove choice {index + 1}
                </button>
              </div>
            </div>
            <div className="creator-field-grid">
              <TextField
                path={`options.${index}.label`}
                label={`Choice ${index + 1} label`}
                value={option.label}
                onChange={(label) => updateOption(option.id, { label })}
                maxLength={160}
                issues={issues}
              />
              <SelectField
                path={`options.${index}.assessment`}
                label={`Choice ${index + 1} assessment`}
                value={option.assessment ?? ""}
                onChange={(value) =>
                  updateOption(option.id, {
                    assessment: (value as typeof option.assessment) || null,
                  })
                }
                choices={[
                  { value: "", label: "Choose assessment" },
                  {
                    value: "recommended",
                    label: "Preferred under these assumptions",
                  },
                  { value: "reasonable", label: "Defensible" },
                  { value: "risky", label: "Risky" },
                ]}
                issues={issues}
              />
            </div>
            <TextField
              path={`options.${index}.explanation`}
              label={`Choice ${index + 1} explanation`}
              value={option.explanation}
              onChange={(explanation) =>
                updateOption(option.id, { explanation })
              }
              multiline
              maxLength={4000}
              issues={issues}
            />
            <div className="creator-field-grid">
              <ListField
                path={`options.${index}.acceptableWhen`}
                label={`Choice ${index + 1}: defensible when`}
                value={option.acceptableWhen}
                onChange={(acceptableWhen) =>
                  updateOption(option.id, { acceptableWhen })
                }
                issues={issues}
              />
              <ListField
                path={`options.${index}.risks`}
                label={`Choice ${index + 1} risks`}
                value={option.risks}
                onChange={(risks) => updateOption(option.id, { risks })}
                issues={issues}
              />
            </div>
          </section>
        ))}
        <button
          type="button"
          className="button button-secondary"
          onClick={addOption}
          disabled={content.options.length >= 5}
        >
          Add choice
        </button>
      </fieldset>
    </>
  );
}
