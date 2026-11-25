"use client";
import { useEffect, useId, useRef } from "react";
import { useScenarioDialog } from "@/components/library/ScenarioInteractionScope";
import { REPORT_CATEGORIES, type ReportCategory } from "@/contracts/moderation";
import type { useScenarioReport } from "@/hooks/use-scenario-report";
export type ReportFormState = ReturnType<typeof useScenarioReport>;
export const REPORT_LABELS: Record<ReportCategory, string> = {
  broken_video: "Video unavailable",
  spoiler: "Pause or spoiler issue",
  incorrect_context: "Incorrect context",
  analysis_issue: "Analysis concern",
  inappropriate_content: "Inappropriate content",
  other: "Other",
};
export function ReportReceiptMessage({ report }: { report: ReportFormState }) {
  if (!report.receipt) return null;
  return (
    <p role="status">
      {report.receipt.duplicate
        ? report.receipt.report.status === "open"
          ? "Already reported — your existing report is under review."
          : "Already reported — your existing report has been reviewed."
        : "Report received. Thank you for flagging this moment."}{" "}
      Reference: {report.receipt.report.id}
    </p>
  );
}
export function ReportScenarioDialog({ report }: { report: ReportFormState }) {
  useScenarioDialog(report.open);
  const element = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    details = useRef<HTMLTextAreaElement>(null),
    categoryField = useRef<HTMLSelectElement>(null);
  const hadReceipt = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!report.open) return;
    const dialog = element.current,
      trigger = document.activeElement;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    cancel.current?.focus();
    return () => {
      if (dialog?.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [report.open]);
  useEffect(() => {
    if (report.open && (report.pending || report.receipt))
      cancel.current?.focus();
  }, [report.open, report.pending, report.receipt]);
  useEffect(() => {
    if (report.open && hadReceipt.current && !report.receipt)
      categoryField.current?.focus();
    hadReceipt.current = !!report.receipt;
  }, [report.open, report.receipt]);
  useEffect(() => {
    if (report.open && report.error && !report.unresolved && !report.changed)
      details.current?.focus();
  }, [report.error, report.open, report.unresolved, report.changed]);
  if (!report.open || report.invalid) return null;
  return (
    <dialog
      ref={element}
      className="session-dialog report-dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onCancel={(e) => {
        e.preventDefault();
        report.close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          report.close();
        }
        if (e.key !== "Tab") return;
        const all = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            "button:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
          ),
        );
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <span className="eyebrow">HELP IMPROVE THIS MOMENT</span>
      <h2 id={`${id}-title`}>Report a problem</h2>
      <p>
        Describe the issue with this scenario. Reporting does not change your
        answer or automatically hide the scenario.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void report.submit();
        }}
      >
        <label className="report-field" htmlFor={`${id}-category`}>
          Problem type
          <select
            ref={categoryField}
            id={`${id}-category`}
            value={report.category}
            disabled={report.pending || report.unresolved || !!report.receipt}
            onChange={(e) =>
              report.setCategory(e.target.value as ReportCategory)
            }
          >
            {REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {REPORT_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="report-field" htmlFor={`${id}-detail`}>
          Details{report.category === "other" ? " (required)" : " (optional)"}
          <textarea
            ref={details}
            id={`${id}-detail`}
            rows={5}
            value={report.detail}
            disabled={report.pending || report.unresolved || !!report.receipt}
            onChange={(e) => report.setDetail(e.target.value)}
            aria-describedby={`${id}-count`}
          />
        </label>
        <p id={`${id}-count`} className="quiet-note">
          {[...report.detail].length} / 2,000 characters. Plain text only.
        </p>
        {report.error && (
          <p role="alert" className="field-error">
            {report.error}
          </p>
        )}
        {report.pending && (
          <p role="status">
            Sending or checking your report… You can close this form; the
            request will continue.
          </p>
        )}
        <ReportReceiptMessage report={report} />
        {report.changed && (
          <div className="creator-alert">
            <p>The report still refers to the version you originally opened.</p>
            {report.latest ? (
              <>
                <strong>{report.latest.title}</strong>
                <p>{report.latest.context}</p>
                <p>Latest version: {report.latest.contentVersion}</p>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    report.acceptUpdatedTarget();
                    details.current?.focus();
                  }}
                >
                  Use this updated version
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button-secondary"
                disabled={report.pending}
                onClick={() => void report.loadLatest()}
              >
                Check latest version
              </button>
            )}
          </div>
        )}
        <div className="card-actions">
          <button
            ref={cancel}
            type="button"
            className="button button-secondary"
            onClick={report.close}
          >
            Close
          </button>
          {report.receipt ? (
            <button
              key="another-report"
              type="button"
              className="text-button"
              onClick={(event) => {
                // Reset must not become a submit activation as the form rerenders.
                event.preventDefault();
                report.another();
              }}
            >
              Report another issue
            </button>
          ) : report.unresolved ? (
            <button
              key="retry-report"
              type="button"
              className="button button-primary"
              disabled={report.pending}
              onClick={() => void report.retry()}
            >
              Retry report
            </button>
          ) : (
            <button
              key="submit-report"
              type="submit"
              className="button button-primary"
              disabled={report.pending || report.changed}
            >
              Submit report
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
export function ReportRequestStatus({ report }: { report: ReportFormState }) {
  if (report.open) return null;
  return (
    <div className="report-status" aria-live="polite">
      {report.pending ? (
        <p>Sending or checking your report…</p>
      ) : report.receipt ? (
        <ReportReceiptMessage report={report} />
      ) : report.error ? (
        <p role="alert">
          {report.error}{" "}
          {report.unresolved && (
            <button className="text-button" onClick={() => void report.retry()}>
              Retry report
            </button>
          )}
        </p>
      ) : null}
    </div>
  );
}
