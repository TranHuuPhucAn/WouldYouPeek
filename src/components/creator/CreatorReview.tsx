"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CreatorCommand,
  CreatorReviewPreview,
  CreatorScenarioSnapshot,
  PublishDraftRequest,
  ReviewChecklist,
  ReviewDraftRequest,
} from "@/contracts/creator";
import { REVIEW_CHECKLIST_KEYS } from "@/contracts/creator";
import {
  getCreatorReview,
  getCreatorScenario,
  publishCreatorScenario,
  reviewCreatorScenario,
  unpublishCreatorScenario,
} from "@/lib/client/creator-api";
import { validateCreatorContinuity } from "@/lib/client/creator-validation";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { ScenarioPreview } from "./ScenarioPreview";
import { PublicationControls } from "./PublicationControls";
import { CreatorStatus } from "./CreatorStatus";
import { fieldId } from "./EditorFields";
const labels: Record<keyof ReviewChecklist, string> = {
  povInformationChecked:
    "The scenario uses only information available to the player.",
  setupSpoilersChecked:
    "The setup and question do not reveal the later outcome.",
  pauseTimingChecked:
    "I checked that the pause occurs before the decision is revealed.",
  continuationChecked:
    "I played the continuation and checked the observed action and playback.",
  normalSpeedAudioChecked:
    "I listened at normal speed and checked source audio for spoilers, or accounted for a silent recording.",
  alternativeChoicesChecked:
    "I reviewed each alternative, its assumptions, risks and uncertainties.",
  sourceAttributionChecked:
    "I checked the source credit, player and round information.",
};
const emptyChecklist = () =>
  Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((key) => [key, false]),
  ) as ReviewChecklist;
type Command =
  | { kind: "review"; input: ReviewDraftRequest }
  | { kind: "publish"; input: PublishDraftRequest }
  | { kind: "unpublish"; input: CreatorCommand };
export function CreatorReview({
  initial,
  initialPreview,
  initialError,
  viewerId,
}: {
  initial: CreatorScenarioSnapshot;
  initialPreview: CreatorReviewPreview | null;
  initialError?: string;
  viewerId: string;
}) {
  const [scenario, setScenario] = useState(initial),
    [preview, setPreview] = useState(initialPreview),
    [checklist, setChecklist] = useState<ReviewChecklist>(
      initial.review?.checklist ?? emptyChecklist,
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(initialError ?? null),
    [unresolved, setUnresolved] = useState(false),
    [conflict, setConflict] = useState(!!initialError),
    [invalid, setInvalid] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null),
    command = useRef<Command | null>(null),
    valid = useRef(true),
    current = useRef(scenario),
    owner = useRef(viewerId);
  current.current = scenario;
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      command.current = null;
      setPreview(null);
      setInvalid(true);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, []);
  useEffect(() => {
    if (owner.current !== viewerId) {
      valid.current = false;
      request.current?.abort();
      setInvalid(true);
      setPreview(null);
    }
  }, [viewerId]);
  function authFailure(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  async function execute(next: Command) {
    if (request.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    command.current = next;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        next.kind === "review"
          ? await reviewCreatorScenario(
              initial.id,
              next.input,
              controller.signal,
            )
          : next.kind === "publish"
            ? await publishCreatorScenario(
                initial.id,
                next.input,
                controller.signal,
              )
            : await unpublishCreatorScenario(
                initial.id,
                next.input,
                controller.signal,
              );
      if (controller.signal.aborted || !valid.current) return;
      validateCreatorContinuity(result.scenario, current.current);
      const contentChanged =
        result.scenario.draft.revision !== current.current.draft.revision;
      setScenario(result.scenario);
      if (contentChanged) {
        setPreview(null);
        setChecklist(emptyChecklist());
        setConflict(true);
        setNotice(
          "The draft changed after this command. Reload the latest saved preview before continuing.",
        );
      } else {
        // Review/publication changes the owner revision, while this preview's draft stays identical.
        setPreview((saved) =>
          saved ? { ...saved, scenario: result.scenario } : null,
        );
        setChecklist(result.scenario.review?.checklist ?? emptyChecklist());
        setConflict(false);
        setNotice(
          next.kind === "review"
            ? "Saved revision reviewed. You can publish it now."
            : next.kind === "publish"
              ? `Publication confirmed${result.publishedVersion ? ` (${result.publishedVersion})` : ""}. The status below shows the latest saved state.`
              : "Scenario withdrawn. Existing learner sessions keep their saved content.",
        );
      }
      command.current = null;
      setUnresolved(false);
    } catch (error) {
      if (controller.signal.aborted || !valid.current || authFailure(error))
        return;
      const rejected =
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500;
      const stale = error instanceof ApiClientError && error.status === 409;
      if (rejected) command.current = null;
      setUnresolved(!rejected);
      setConflict(stale);
      setError(
        stale
          ? "This saved revision or review has changed. Reload and review the latest draft."
          : rejected
            ? error.message
            : "We couldn’t confirm this action. Retry the same action to safely recover its result.",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  async function reloadReview() {
    if (request.current || !valid.current || command.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const latest = await getCreatorScenario(initial.id, controller.signal);
      validateCreatorContinuity(latest, current.current);
      const nextPreview = latest.readiness.canReview
        ? await getCreatorReview(initial.id, latest.revision, controller.signal)
        : null;
      if (controller.signal.aborted || !valid.current) return;
      setScenario(latest);
      setPreview(nextPreview);
      setChecklist(latest.review?.checklist ?? emptyChecklist());
      setConflict(false);
      setNotice(null);
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authFailure(error))
        setError("The latest review couldn’t load. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  const base = () => ({
    requestId: crypto.randomUUID(),
    expectedRevision: scenario.revision,
  });
  const canReview = scenario.readiness.canReview && !!preview && !conflict;
  if (invalid)
    return (
      <p role="status">Your creator session has changed. Refreshing access…</p>
    );
  return (
    <div className="creator-review">
      <Link href={`/creator/scenarios/${initial.id}`} className="text-button">
        ← Edit draft
      </Link>
      <div className="page-heading">
        <span className="eyebrow">REVIEW THE SAVED MOMENT</span>
        <h1>{scenario.draft.content.title || "Untitled scenario"}</h1>
        <p>
          Draft {scenario.draft.revision} · Saved{" "}
          {new Date(scenario.draft.savedAt).toLocaleString()}. Review means your
          own editorial assessment.
        </p>
        <CreatorStatus
          publication={scenario.publication}
          reviewed={!!scenario.review}
          canReview={scenario.readiness.canReview}
        />
      </div>
      {error && (
        <div className="creator-alert" role="alert">
          <p>{error}</p>
          {unresolved ? (
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => command.current && void execute(command.current)}
            >
              Retry the same action
            </button>
          ) : (
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => void reloadReview()}
            >
              Reload latest review
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="creator-notice">
          {notice}
        </p>
      )}
      {conflict && !error && (
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => void reloadReview()}
        >
          Reload latest review
        </button>
      )}
      {!scenario.readiness.canReview && (
        <section className="creator-issues">
          <h2>Complete the draft before review</h2>
          <ul>
            {scenario.readiness.issues.map((issue, index) => (
              <li key={index}>
                <Link
                  href={`/creator/scenarios/${initial.id}#${fieldId(issue.path)}`}
                >
                  {issue.message}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {preview && (
        <ScenarioPreview
          key={`${viewerId}-${scenario.id}-${scenario.draft.revision}`}
          preview={preview}
        />
      )}
      <section className="surface-card review-checklist">
        <h2>Editorial review</h2>
        <p>
          Play the saved preview, listen to the source, and check every choice.
          These confirmations record your review; they are not independent
          verification.
        </p>
        <fieldset
          disabled={pending || unresolved || !canReview || !!scenario.review}
        >
          <legend className="sr-only">Confirm your review</legend>
          {REVIEW_CHECKLIST_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={checklist[key]}
                onChange={(event) =>
                  setChecklist({ ...checklist, [key]: event.target.checked })
                }
              />
              <span>{labels[key]}</span>
            </label>
          ))}
        </fieldset>
        <button
          className="button button-primary"
          disabled={
            pending ||
            unresolved ||
            !canReview ||
            !REVIEW_CHECKLIST_KEYS.every((key) => checklist[key]) ||
            !!scenario.review
          }
          onClick={() =>
            void execute({
              kind: "review",
              input: { ...base(), checklist: { ...checklist } },
            })
          }
        >
          {pending
            ? "Saving…"
            : scenario.review
              ? "This revision is reviewed"
              : "Mark reviewed"}
        </button>
      </section>
      <PublicationControls
        scenario={scenario}
        disabled={pending || unresolved || conflict}
        onPublish={() => {
          if (scenario.review)
            void execute({
              kind: "publish",
              input: { ...base(), reviewId: scenario.review.id },
            });
        }}
        onUnpublish={() => void execute({ kind: "unpublish", input: base() })}
      />
    </div>
  );
}
