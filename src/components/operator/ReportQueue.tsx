"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { OperatorReportList, ReportStatus } from "@/contracts/moderation";
import { fetchOperatorReports } from "@/lib/client/moderation-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { REPORT_LABELS } from "@/components/reports/ReportScenarioDialog";
export function ReportQueue({
  initial,
  initialStatus = "open",
  viewerId,
}: {
  initial: OperatorReportList;
  initialStatus?: ReportStatus;
  viewerId: string;
}) {
  const [data, setData] = useState(initial),
    [filter, setFilter] = useState(initialStatus),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [invalid, setInvalid] = useState(false);
  const request = useRef<AbortController | null>(null),
    valid = useRef(true),
    owner = useRef(viewerId),
    retryCursor = useRef<string | null>(null);
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      setInvalid(true);
      setData({ reports: [], nextCursor: null });
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    if (owner.current !== viewerId) invalidate();
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [viewerId]);
  async function load(nextFilter: ReportStatus, cursor: string | null = null) {
    if (!valid.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    retryCursor.current = cursor;
    setPending(true);
    setError(null);
    if (!cursor) setData({ reports: [], nextCursor: null });
    try {
      const next = await fetchOperatorReports(
        { status: nextFilter, cursor },
        controller.signal,
      );
      if (controller.signal.aborted || !valid.current) return;
      setData((old) => ({
        reports: cursor
          ? [
              ...new Map(
                [...old.reports, ...next.reports].map((r) => [r.id, r]),
              ).values(),
            ]
          : next.reports,
        nextCursor: next.nextCursor,
      }));
    } catch (error) {
      if (controller.signal.aborted || !valid.current) return;
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      setError("Reports couldn’t be loaded. Please retry.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  if (invalid || owner.current !== viewerId)
    return (
      <p role="status">
        Operator access changed. Return to Account to continue.
      </p>
    );
  return (
    <section aria-label="Scenario report queue">
      <label className="report-field">
        Report status
        <select
          value={filter}
          onChange={(e) => {
            const next = e.target.value as ReportStatus;
            setFilter(next);
            void load(next);
          }}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      {pending && <p role="status">Loading reports…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => void load(filter, retryCursor.current)}
            disabled={pending}
          >
            Retry reports
          </button>
        </p>
      )}
      {!pending && !error && !data.reports.length && (
        <p>No {filter} reports.</p>
      )}
      <div className="history-list">
        {data.reports.map((report) => (
          <article className="surface-card" key={report.id}>
            <span className="eyebrow">
              {REPORT_LABELS[report.category]} · {report.status}
            </span>
            <h2>
              <Link href={`/operator/reports/${report.id}`}>
                Review report {report.id}
              </Link>
            </h2>
            <p>
              Scenario {report.scenarioId} · Version {report.contentVersion}
            </p>
            <p>{report.detail || "No additional details supplied."}</p>
            <time dateTime={report.createdAt}>
              {new Date(report.createdAt).toLocaleString()}
            </time>
          </article>
        ))}
      </div>
      {data.nextCursor && (
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => void load(filter, data.nextCursor)}
        >
          Load more reports
        </button>
      )}
    </section>
  );
}
