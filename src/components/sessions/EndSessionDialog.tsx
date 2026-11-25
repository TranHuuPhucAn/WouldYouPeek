"use client";

import { useEffect, useId, useRef, type RefObject } from "react";
import { useScenarioDialog } from "@/components/library/ScenarioInteractionScope";

/** The caller owns the command; closing this dialog never cancels a save. */
export function EndSessionDialog({
  open,
  answeredCount,
  totalCount,
  hasUnsubmittedChoice = false,
  pending,
  unresolved,
  error,
  onConfirm,
  onRetry,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  answeredCount: number;
  totalCount: number;
  hasUnsubmittedChoice?: boolean;
  pending: boolean;
  unresolved: boolean;
  error: string | null;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  useScenarioDialog(open);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const trigger = document.activeElement;
    if (element && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    cancel.current?.focus();
    return () => {
      if (element?.open) {
        if (typeof element.close === "function") element.close();
        else element.removeAttribute("open");
      }
      const destination = returnFocusRef?.current ?? trigger;
      if (destination instanceof HTMLElement && destination.isConnected) {
        if (destination.matches(":disabled")) {
          destination
            .closest<HTMLElement>(".session-end-action, .active-session-end")
            ?.focus();
        } else destination.focus();
      }
    };
  }, [open, returnFocusRef]);
  if (!open) return null;
  const fullyAnswered = answeredCount === totalCount;
  return (
    <dialog
      ref={dialog}
      className="session-dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <span className="eyebrow">YOUR SAVED SESSION</span>
      <h2 id={titleId}>
        {fullyAnswered ? "Every decision is saved." : "End this session?"}
      </h2>
      <div id={descriptionId}>
        <p>
          {answeredCount} of {totalCount} decisions saved.
        </p>
        {fullyAnswered ? (
          <p>Close this dialog and use Finish session to complete your run.</p>
        ) : (
          <>
            <p>
              Your saved decisions stay in History. The remaining{" "}
              {totalCount - answeredCount}{" "}
              {totalCount - answeredCount === 1
                ? "scenario will"
                : "scenarios will"}{" "}
              be left unanswered. This session cannot be resumed.
            </p>
            {hasUnsubmittedChoice && (
              <p>
                Your selected choice has not been submitted and will not be
                saved.
              </p>
            )}
          </>
        )}
      </div>
      {pending && (
        <p role="status">
          Ending your session… Closing this dialog does not cancel the request.
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="card-actions">
        <button
          ref={cancel}
          className="button button-secondary"
          onClick={onClose}
        >
          {pending || unresolved || fullyAnswered ? "Close" : "Keep practising"}
        </button>
        {!fullyAnswered && (
          <button
            className="button button-primary"
            disabled={pending}
            onClick={unresolved ? onRetry : onConfirm}
          >
            {pending
              ? "Ending…"
              : unresolved
                ? "Retry ending session"
                : "End session"}
          </button>
        )}
      </div>
    </dialog>
  );
}
