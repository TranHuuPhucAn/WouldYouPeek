"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SessionHistoryResponse } from "@/contracts/session";
import { listSessions } from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function SessionHistory({
  initialHistory,
}: {
  initialHistory: SessionHistoryResponse;
}) {
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function loadMore() {
    if (request.current || !history.nextCursor) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await listSessions(history.nextCursor, controller.signal);
      if (!controller.signal.aborted)
        setHistory((previous) => ({
          sessions: [
            ...new Map(
              [...previous.sessions, ...next.sessions].map((item) => [
                item.id,
                item,
              ]),
            ).values(),
          ],
          nextCursor: next.nextCursor,
        }));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      setError("More sessions couldn’t load. Please try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  if (!history.sessions.length)
    return (
      <section className="surface-card">
        <h2>Your first session starts here.</h2>
        <p>Saved decisions and completed debriefs will appear here.</p>
        <Link href="/play" className="button button-primary">
          Start playing →
        </Link>
      </section>
    );
  return (
    <>
      <div className="history-list">
        {history.sessions.map((item) => (
          <article className="surface-card history-row" key={item.id}>
            <div>
              <span className="eyebrow">
                {item.status === "completed" ? "COMPLETED" : "IN PROGRESS"}
              </span>
              <h2>
                {new Date(item.createdAt).toLocaleDateString("en", {
                  dateStyle: "long",
                  timeZone: "UTC",
                })}
              </h2>
              <p>
                {item.answeredCount} of {item.totalCount} decisions saved
              </p>
            </div>
            <Link href={`/play/${item.id}`} className="button button-secondary">
              {item.status === "completed"
                ? "Review session"
                : "Resume session"}{" "}
              →
            </Link>
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {history.nextCursor && (
        <button
          className="button button-secondary"
          onClick={loadMore}
          disabled={pending}
        >
          {pending ? "Loading…" : "Load more sessions"}
        </button>
      )}
    </>
  );
}
