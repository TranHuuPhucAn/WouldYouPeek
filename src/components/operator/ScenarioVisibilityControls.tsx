"use client";
import { useEffect, useRef, useState } from "react";
import type {
  ScenarioVisibility,
  VisibilityRequest,
} from "@/contracts/moderation";
export function ScenarioVisibilityControls({
  visibility,
  disabled,
  onChange,
}: {
  visibility: ScenarioVisibility;
  disabled: boolean;
  onChange: (input: VisibilityRequest) => void;
}) {
  const [reason, setReason] = useState(""),
    [confirmation, setConfirmation] = useState<{
      revision: number;
      hidden: boolean;
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => setConfirmation(null), [visibility.revision]);
  useEffect(() => {
    if (confirmation) heading.current?.focus();
    else if (wasConfirming.current) actionButton.current?.focus();
    wasConfirming.current = !!confirmation;
  }, [confirmation]);
  return (
    <section className="surface-card">
      <span className="eyebrow">SCENARIO VISIBILITY</span>
      <h2>{visibility.hidden ? "Hidden by operator" : "No operator hold"}</h2>
      <p>
        Creator publication:{" "}
        {visibility.creatorPublished
          ? "published"
          : "withdrawn or not published"}
        .
      </p>
      {visibility.reason && <p>Latest operator reason: {visibility.reason}</p>}
      <label className="report-field">
        Reason shared with the creator
        <textarea
          ref={reasonField}
          rows={3}
          value={reason}
          disabled={disabled || !!confirmation}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="quiet-note">
        Required · Up to 1,000 characters. Reporter details and private notes
        are not shared.
      </p>
      {error && <p role="alert">{error}</p>}
      {!confirmation ? (
        <button
          ref={actionButton}
          className="button button-secondary"
          disabled={disabled}
          onClick={() => {
            if (!reason.trim() || [...reason.trim()].length > 1000) {
              setError("Enter a reason of 1–1,000 characters.");
              reasonField.current?.focus();
              return;
            }
            setError(null);
            setConfirmation({
              revision: visibility.revision,
              hidden: !visibility.hidden,
            });
          }}
        >
          {visibility.hidden ? "Restore scenario" : "Hide scenario"}
        </button>
      ) : (
        <div
          role="group"
          aria-label={
            confirmation.hidden
              ? "Confirm hiding scenario"
              : "Confirm restoring scenario"
          }
          className="creator-alert"
        >
          <h3 ref={heading} tabIndex={-1}>
            {confirmation.hidden
              ? "Hide this scenario?"
              : "Remove the operator hold?"}
          </h3>
          <p>
            {confirmation.hidden
              ? "This hides the current scenario and future republishes until restored. It blocks public discovery and new starts; existing owned sessions and saved history remain available."
              : "Restoring removes only the operator hold. A creator-withdrawn scenario stays unavailable. Affected creator playlists need review and republication."}
          </p>
          <p>
            {visibility.affectedPlaylistCount} published playlists depend on
            this scenario.
          </p>
          {visibility.affectedEditorialPlaylistCount > 0 && (
            <p>
              The editorial starter playlist needs the trusted maintenance
              repair after restoration; it has no creator editor.
            </p>
          )}
          <div className="card-actions">
            <button
              className="button button-primary"
              disabled={disabled}
              onClick={() =>
                onChange({
                  requestId: crypto.randomUUID(),
                  expectedRevision: confirmation.revision,
                  hidden: confirmation.hidden,
                  reason: reason.trim(),
                })
              }
            >
              {confirmation.hidden ? "Confirm hide" : "Confirm restore"}
            </button>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
