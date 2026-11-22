"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  OperatorReportDetail,
  ResolveReportRequest,
  VisibilityRequest,
  ReportResolution,
} from "@/contracts/moderation";
import {
  fetchOperatorReport,
  resolveReport,
  setScenarioVisibility,
} from "@/lib/client/moderation-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { REPORT_LABELS } from "@/components/reports/ReportScenarioDialog";
import { ScenarioContext } from "@/components/challenge/ScenarioContext";
import { ReportMediaPreview } from "./ReportMediaPreview";
import { ScenarioVisibilityControls } from "./ScenarioVisibilityControls";
type Command =
  | { kind: "resolve"; input: ResolveReportRequest }
  | { kind: "visibility"; input: VisibilityRequest };
export function ReportDetail({
  initial,
  viewerId,
}: {
  initial: OperatorReportDetail;
  viewerId: string;
}) {
  const [detail, setDetail] = useState<OperatorReportDetail | null>(initial),
    [note, setNote] = useState(""),
    [resolution, setResolution] = useState<ReportResolution>("addressed");
  const [pending, setPending] = useState(false),
    [unresolved, setUnresolved] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [mustRefresh, setMustRefresh] = useState(false);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null),
    command = useRef<Command | null>(null),
    valid = useRef(true),
    owner = useRef(viewerId),
    current = useRef(detail);
  current.current = detail;
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      command.current = null;
      setDetail(null);
      setNote("");
      setError(null);
      setNotice(null);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    if (owner.current !== viewerId) invalidate();
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [viewerId]);
  function authFailure(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  async function refresh() {
    if (request.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await fetchOperatorReport(
        initial.report.id,
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current) {
        setDetail(next);
        setMustRefresh(false);
        setNotice(
          "Latest state loaded. Review it before confirming another action.",
        );
      }
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authFailure(error))
        setError(
          "The current report couldn’t be loaded. Your draft note is kept.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  async function execute(next: Command) {
    if (request.current || !valid.current || !current.current) return;
    const controller = new AbortController();
    request.current = controller;
    command.current = next;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (next.kind === "resolve") {
        const result = await resolveReport(
          initial.report.id,
          next.input,
          controller.signal,
        );
        if (controller.signal.aborted || !valid.current) return;
        setDetail((old) => (old ? { ...old, report: result.report } : null));
        setNotice(
          "Report resolution saved. Scenario visibility was not changed.",
        );
      } else {
        const result = await setScenarioVisibility(
          initial.report.scenarioId,
          next.input,
          controller.signal,
        );
        if (controller.signal.aborted || !valid.current) return;
        setDetail((old) =>
          old ? { ...old, visibility: result.visibility } : null,
        );
        setNotice(
          result.visibility.hidden
            ? "Operator hold saved. New starts are blocked; existing saved sessions remain."
            : result.visibility.creatorPublished
              ? "Operator hold removed. Standalone availability follows the current publication; affected playlists still need review or maintenance."
              : "Operator hold removed. The creator’s scenario is still unpublished.",
        );
      }
      command.current = null;
      setUnresolved(false);
      setMustRefresh(false);
    } catch (error) {
      if (controller.signal.aborted || !valid.current || authFailure(error))
        return;
      const rejected =
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500;
      if (rejected) command.current = null;
      setUnresolved(!rejected);
      if (error instanceof ApiClientError && error.status === 409) {
        setMustRefresh(true);
        try {
          const updated = await fetchOperatorReport(
            initial.report.id,
            controller.signal,
          );
          if (controller.signal.aborted || !valid.current) return;
          setDetail(updated);
          setMustRefresh(false);
        } catch (readError) {
          if (
            controller.signal.aborted ||
            !valid.current ||
            authFailure(readError)
          )
            return;
        }
        setError(
          "This report or visibility state changed. Your text is kept. Review the latest state before making a new confirmation.",
        );
      } else
        setError(
          rejected
            ? (error as ApiClientError).message
            : "We couldn’t confirm the action. Retry the same command to recover its result.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  if (!detail || owner.current !== viewerId)
    return (
      <main className="page-shell">
        <h1>Operator access changed.</h1>
        <Link href="/account" className="button button-secondary">
          Return to Account
        </Link>
      </main>
    );
  const { report, media, visibility } = detail,
    disabled = pending || unresolved || mustRefresh;
  return (
    <main className="page-shell operator-detail">
      <Link className="text-button" href="/operator/reports">
        ← All reports
      </Link>
      <div className="page-heading">
        <span className="eyebrow">
          {report.status.toUpperCase()} · {REPORT_LABELS[report.category]}
        </span>
        <h1>{media.challenge.title}</h1>
        <p>Report reference: {report.id}</p>
      </div>
      {pending && <p role="status">Saving or checking the operator action…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {unresolved && (
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => command.current && void execute(command.current)}
        >
          Retry operator action
        </button>
      )}
      {!unresolved && (
        <button
          className="text-button"
          disabled={pending}
          onClick={() => void refresh()}
        >
          Refresh report state
        </button>
      )}
      <section className="surface-card">
        <h2>Reported issue.</h2>
        <p className="report-text">
          {report.detail || "No additional details supplied."}
        </p>
        <p>Reported version: {report.contentVersion}</p>
        <p>
          Current publication version:{" "}
          {visibility.currentContentVersion ?? "No publication"} ·{" "}
          {visibility.creatorPublished ? "Published" : "Unpublished"}
        </p>
        {visibility.currentContentVersion !== report.contentVersion && (
          <p className="creator-alert">
            The report concerns an older version. Playback and explanation below
            are from that reported version. A visibility hold applies to the
            whole scenario.
          </p>
        )}
      </section>
      <ReportMediaPreview
        key={`${report.id}:${media.challenge.contentVersion}`}
        reportId={report.id}
        media={media}
      />
      <section className="surface-card">
        <h2>Reported context and explanation.</h2>
        <ScenarioContext challenge={media.challenge} />
        <h3>{media.challenge.question}</h3>
        {media.observedAction && (
          <>
            <h3>Observed action</h3>
            <p>{media.observedAction.description}</p>
          </>
        )}
        {media.analysis && (
          <>
            <h3>Authored analysis</h3>
            <p>{media.analysis.rationale}</p>
            <p className="quiet-note">{media.analysis.notice}</p>
            <ul>
              {media.analysis.limitations.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {media.optionFeedback.map((option) => (
          <details key={option.optionId}>
            <summary>
              {
                media.challenge.options.find((o) => o.id === option.optionId)
                  ?.label
              }{" "}
              · {option.assessment}
            </summary>
            <p>{option.explanation}</p>
            <h4>Acceptable when</h4>
            <ul>
              {option.acceptableWhen.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <h4>Risks</h4>
            <ul>
              {option.risks.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </details>
        ))}
        <p>{media.takeaway}</p>
        <p>{media.outcomeText}</p>
      </section>
      <ScenarioVisibilityControls
        visibility={visibility}
        disabled={disabled}
        onChange={(input) => void execute({ kind: "visibility", input })}
      />
      <section className="surface-card">
        <h2>Resolve this report.</h2>
        {report.status === "resolved" ? (
          <>
            <p>Resolution: {report.resolution}</p>
            <p className="report-text">{report.operatorNote}</p>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled) return;
              if (!note.trim() || [...note.trim()].length > 2000) {
                setError("Enter a private note of 1–2,000 characters.");
                noteField.current?.focus();
                return;
              }
              void execute({
                kind: "resolve",
                input: {
                  requestId: crypto.randomUUID(),
                  expectedRevision: report.revision,
                  resolution,
                  operatorNote: note.trim(),
                },
              });
            }}
          >
            <label className="report-field">
              Resolution
              <select
                value={resolution}
                disabled={disabled}
                onChange={(e) =>
                  setResolution(e.target.value as ReportResolution)
                }
              >
                <option value="addressed">Addressed</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </label>
            <label className="report-field">
              Private operator note
              <textarea
                ref={noteField}
                rows={4}
                value={note}
                disabled={disabled}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <p className="quiet-note">
              Required · Up to 2,000 characters. This note is not shared with
              the creator.
            </p>
            <button className="button button-primary" disabled={disabled}>
              Resolve report
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
