"use client";
import { useState } from "react";
import Link from "next/link";
import type { CreatorScenarioSnapshot } from "@/contracts/creator";
export function PublicationControls({
  scenario,
  disabled,
  onPublish,
  onUnpublish,
}: {
  scenario: CreatorScenarioSnapshot;
  disabled: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const [confirming, setConfirming] = useState(false),
    published = scenario.publication.state === "published";
  return (
    <section className="publication-controls surface-card">
      <span className="eyebrow">PUBLICATION</span>
      <h2>{published ? "Your published scenario" : "Ready for learners?"}</h2>
      {scenario.publication.operatorVisibility.hidden && (
        <div className="creator-alert" role="status">
          <strong>Hidden by operator</strong>
          <p>{scenario.publication.operatorVisibility.reason}</p>
          <p>
            You can edit and publish a corrected version. It will stay hidden
            until the operator restores visibility.
          </p>
        </div>
      )}
      <p>
        {scenario.draft.content.title || "Untitled scenario"} · Draft{" "}
        {scenario.draft.revision}
      </p>
      <p className="quiet-note">
        {scenario.draft.content.source.title || "Source not supplied"} ·{" "}
        {scenario.draft.content.source.uploader || "Uploader not supplied"}
      </p>
      <p className="quiet-note">
        Publication uses the reviewed saved revision. Existing learner sessions
        keep their original version.
      </p>
      <div className="publication-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={
            disabled ||
            !scenario.review ||
            (published && !scenario.publication.hasUnpublishedChanges)
          }
          onClick={onPublish}
        >
          {published ? "Publish update" : "Publish scenario"}
        </button>
        {published && (
          <>
            {!scenario.publication.operatorVisibility.hidden && (
              <Link className="text-button" href={`/library/${scenario.id}`}>
                View library entry ↗
              </Link>
            )}
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => setConfirming(true)}
            >
              Unpublish
            </button>
          </>
        )}
      </div>
      {!scenario.review && (
        <p className="quiet-note">
          Mark this saved draft reviewed to enable publication.
        </p>
      )}
      {confirming && published && (
        <div
          className="creator-alert"
          role="group"
          aria-label="Confirm unpublish"
        >
          <p>
            Remove this scenario from the library and prevent new starts?
            Existing sessions and history remain available. Restoring visibility
            requires review again.
          </p>
          <div className="publication-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled}
              onClick={() => {
                onUnpublish();
                setConfirming(false);
              }}
            >
              Confirm unpublish
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setConfirming(false)}
            >
              Keep published
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
