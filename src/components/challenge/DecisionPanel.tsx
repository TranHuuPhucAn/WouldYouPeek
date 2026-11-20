"use client";

import { useEffect, useId, useRef } from "react";
import type { ChallengeOption } from "@/contracts/challenge";

type Props = {
  question?: string;
  options: ChallengeOption[];
  selectedOptionId: string | null;
  pending: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onSubmit: () => void;
  onReplay: () => void;
};

export function DecisionPanel({
  question,
  options,
  selectedOptionId,
  pending,
  error,
  onSelect,
  onSubmit,
  onReplay,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const errorId = useId();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="decision-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR MOVE</span>
          <h2 ref={heading} tabIndex={-1}>
            {question ?? "What’s your call?"}
          </h2>
        </div>
        <button className="text-button" onClick={onReplay} disabled={pending}>
          ↺ Replay setup
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedOptionId && !pending) onSubmit();
        }}
      >
        <fieldset
          disabled={pending}
          aria-describedby={error ? errorId : undefined}
        >
          <legend className="sr-only">Choose your action</legend>
          <div className="option-list">
            {options.map((option, index) => (
              <label
                className={`option-card ${selectedOptionId === option.id ? "is-selected" : ""}`}
                key={option.id}
              >
                <input
                  type="radio"
                  name="action"
                  value={option.id}
                  checked={selectedOptionId === option.id}
                  onChange={() => onSelect(option.id)}
                />
                <span className="option-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <span className="option-label">{option.label}</span>
                <span className="radio-mark" aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="inline-error" id={errorId} role="alert">
            {error}
          </p>
        )}
        <div className="decision-footer">
          <span>Choose before seeing the outcome.</span>
          <button
            className="button button-primary"
            disabled={!selectedOptionId || pending}
            type="submit"
          >
            {pending ? "Submitting…" : "Lock in your call"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}
