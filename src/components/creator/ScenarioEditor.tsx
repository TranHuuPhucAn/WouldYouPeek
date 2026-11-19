"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CreatorScenarioSnapshot,
  ValidationIssue,
} from "@/contracts/creator";
import {
  validateDraftContent,
  validatePublishContent,
  normalizeDraftContent,
} from "@/lib/creator/content";
import { useScenarioEditor } from "@/hooks/use-scenario-editor";
import { AnalysisFields } from "./AnalysisFields";
import { DecisionFields } from "./DecisionFields";
import { SourceFields } from "./SourceFields";
import { VideoTimingEditor } from "./VideoTimingEditor";
import { fieldId } from "./EditorFields";
import { CreatorStatus } from "./CreatorStatus";

export function ScenarioEditor({
  initial,
  viewerId,
}: {
  initial: CreatorScenarioSnapshot;
  viewerId: string;
}) {
  const editor = useScenarioEditor(initial, viewerId),
    { state } = editor;
  const [inputIssues, setInputIssues] = useState<ValidationIssue[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [sourceReset, setSourceReset] = useState(0);
  const [pendingSource, setPendingSource] = useState<{
    source: typeof state.content.source;
    field: string;
  } | null>(null);
  const cancelSourceButton = useRef<HTMLButtonElement>(null);
  const focusTimingAfterChange = useRef(false);
  useEffect(() => {
    if (pendingSource) cancelSourceButton.current?.focus();
  }, [pendingSource]);
  useEffect(() => {
    if (focusTimingAfterChange.current) {
      focusTimingAfterChange.current = false;
      document.getElementById(fieldId("media.startSeconds"))?.focus();
    }
  }, [sourceReset]);
  const dirty = editor.dirty || inputIssues.length > 0;
  useEffect(() => {
    if (!dirty || state.invalid) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeLink = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest("a");
      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        link.target === "_blank" ||
        link.getAttribute("href")?.startsWith("#")
      )
        return;
      if (
        !window.confirm(
          "Leave with unsaved changes? Your last saved draft will remain available.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [dirty, state.invalid]);
  useEffect(() => {
    setInputIssues([]);
    setShowIssues(false);
    setPendingSource(null);
  }, [state.resetKey]);
  if (state.invalid)
    return (
      <section className="status-panel">
        <h2>Your creator session has changed.</h2>
        <p>Sign in again to return to your saved draft.</p>
        <Link href="/sign-in" className="button button-primary">
          Sign in
        </Link>
      </section>
    );
  const normalized = normalizeDraftContent(state.content);
  const structural = [...validateDraftContent(normalized), ...inputIssues];
  const readiness = validatePublishContent(normalized);
  const issues = showIssues ? [...structural, ...readiness] : inputIssues;
  function replaceSource(source: typeof state.content.source) {
    const media = state.content.media;
    const identity = (value: typeof source) =>
      value.kind === "uploaded" ? `upload:${value.assetId}` : value.url;
    if (identity(source) === identity(state.content.source)) {
      editor.update({ ...state.content, source });
      return true;
    }
    const hasMarks =
      [media.startSeconds, media.decisionSeconds, media.endSeconds].some(
        (value) => value !== null,
      ) || !!(media.setupAlt || media.decisionAlt || media.revealAlt);
    if (hasMarks) {
      const field =
        source.kind !== state.content.source.kind
          ? "source.kind"
          : source.kind === "uploaded"
            ? "source.assetId"
            : "source.url";
      setPendingSource({ source, field });
      return false;
    }
    applySource(source);
    return true;
  }
  function applySource(
    source: typeof state.content.source,
    focusTiming = false,
  ) {
    // The creator can keep editing while deciding. Preserve the latest attribution text.
    const {
      title,
      uploader,
      player,
      map,
      agent,
      score,
      matchType,
      round,
      side,
      publishedDate,
      dateNote,
    } = state.content.source;
    const attribution = {
      title,
      uploader,
      player,
      map,
      agent,
      score,
      matchType,
      round,
      side,
      publishedDate,
      dateNote,
    };
    const nextSource: typeof source =
      source.kind === "uploaded"
        ? {
            ...attribution,
            kind: "uploaded",
            assetId: source.assetId,
            creditUrl:
              state.content.source.kind === "uploaded"
                ? state.content.source.creditUrl
                : source.creditUrl,
          }
        : { ...attribution, url: source.url };
    editor.update({
      ...state.content,
      source: nextSource,
      media: {
        startSeconds: null,
        decisionSeconds: null,
        endSeconds: null,
        setupAlt: "",
        decisionAlt: "",
        revealAlt: "",
      },
    });
    setPendingSource(null);
    focusTimingAfterChange.current = focusTiming;
    setSourceReset((value) => value + 1);
    setInputIssues([]);
  }
  function cancelSourceChange() {
    const field = pendingSource?.field;
    setPendingSource(null);
    if (field) document.getElementById(fieldId(field))?.focus();
  }
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setShowIssues(true);
    if (structural.length) {
      document.getElementById(fieldId(structural[0].path))?.focus();
      return;
    }
    void editor.saveDraft();
  }
  return (
    <div className="creator-editor">
      <div className="creator-intro">
        <Link href="/creator" className="text-button">
          ← Creator workspace
        </Link>
        <h1>{state.content.title || "New scenario"}</h1>
        <p>
          A private draft until you review and publish it. Save incomplete work
          whenever you need.
        </p>
        <CreatorStatus
          publication={state.snapshot.publication}
          canReview={state.snapshot.readiness.canReview}
          reviewed={!!state.snapshot.review}
        />
      </div>
      {pendingSource && (
        <section
          className="creator-alert"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="source-change-title"
          aria-describedby="source-change-description"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelSourceChange();
            }
          }}
        >
          <h2 id="source-change-title">Change the source recording?</h2>
          <p id="source-change-description">
            This clears the three timestamps and media descriptions. Your
            question, choices, and analysis stay in the draft. Check them
            against the new recording before saving.
          </p>
          <div className="creator-save-actions">
            <button
              ref={cancelSourceButton}
              type="button"
              className="button button-secondary"
              onClick={cancelSourceChange}
            >
              Cancel source change
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => applySource(pendingSource.source, true)}
            >
              Change source
            </button>
          </div>
        </section>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <div className="creator-savebar">
          <div role="status" aria-live="polite">
            <strong>
              {state.pending
                ? "Saving…"
                : state.command
                  ? "Save not confirmed"
                  : dirty
                    ? "Unsaved changes"
                    : "All changes saved"}
            </strong>
            <small>
              Last saved{" "}
              {new Date(state.snapshot.draft.savedAt).toLocaleString()} · Draft{" "}
              {state.snapshot.draft.revision}
            </small>
          </div>
          <div className="creator-save-actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={state.pending || state.conflict || !!state.command}
            >
              Save draft
            </button>
            {!dirty && !state.pending && !state.command && !state.conflict ? (
              <Link
                href={`/creator/scenarios/${initial.id}/review`}
                className="button button-secondary"
              >
                Review saved draft →
              </Link>
            ) : (
              <span className="quiet-note">
                Save your changes before review.
              </span>
            )}
          </div>
        </div>
        {state.error && (
          <div className="creator-alert" role="alert">
            <p>{state.error}</p>
            {state.command && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void editor.retrySave()}
              >
                Retry the same save
              </button>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => void editor.fetchLatest()}
            >
              Compare with latest
            </button>
          </div>
        )}
        {state.latest && (
          <section className="creator-comparison">
            <h2>Latest saved draft · revision {state.latest.draft.revision}</h2>
            <p>
              Your local edits remain in the form. Copy any text you want to
              keep before loading the saved draft.
            </p>
            <details>
              <summary>Inspect latest saved content</summary>
              <pre>{JSON.stringify(state.latest.draft.content, null, 2)}</pre>
            </details>
            <button
              className="button button-secondary"
              type="button"
              onClick={editor.acceptLatest}
              disabled={!!state.command}
            >
              Load latest saved draft
            </button>
          </section>
        )}
        {showIssues && issues.length > 0 && (
          <section className="creator-issues" aria-label="Draft validation">
            <h2>
              {structural.length
                ? "Fix these fields before saving"
                : "Saved drafts can be incomplete"}
            </h2>
            <p>
              {structural.length
                ? "Your text is still in the form."
                : "Complete these fields before review and publication."}
            </p>
            <ul>
              {issues.slice(0, 30).map((issue, index) => (
                <li key={`${issue.path}-${index}`}>
                  <a
                    href={`#${fieldId(issue.path)}`}
                    onClick={() =>
                      document.getElementById(fieldId(issue.path))?.focus()
                    }
                  >
                    {issue.message}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        <SourceFields
          source={state.content.source}
          onChange={(source) => editor.update({ ...state.content, source })}
          issues={issues}
          onReplace={replaceSource}
        />
        <VideoTimingEditor
          key={`${state.resetKey}-${sourceReset}`}
          source={state.content.source}
          media={state.content.media}
          onChange={(media) => editor.update({ ...state.content, media })}
          issues={issues}
          onInputIssues={setInputIssues}
        />
        <DecisionFields
          content={state.content}
          onChange={editor.update}
          issues={issues}
        />
        <AnalysisFields
          content={state.content}
          onChange={editor.update}
          issues={issues}
        />
        <div className="creator-bottom-save">
          <button
            className="button button-primary"
            disabled={state.pending || state.conflict || !!state.command}
            type="submit"
          >
            {state.pending ? "Saving…" : "Save draft"}
          </button>
          <p className="quiet-note">
            Saving keeps this private. Review and publish are separate actions.
          </p>
        </div>
      </form>
    </div>
  );
}
