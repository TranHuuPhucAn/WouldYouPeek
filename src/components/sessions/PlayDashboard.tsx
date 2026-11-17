"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SessionSummary } from "@/contracts/session";
import { createOrResumeSession } from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function PlayDashboard({
  activeSession,
}: {
  activeSession: SessionSummary | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function startOrResume() {
    if (request.current) return;
    requestId.current ??= crypto.randomUUID();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await createOrResumeSession(
        { requestId: requestId.current },
        controller.signal,
      );
      if (!controller.signal.aborted)
        router.push(`/play/${response.session.id}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      setError("Your session couldn’t open. Retry to safely resume or start.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section className="surface-card session-start">
      <div>
        <span className="eyebrow">TENZ · CLOVE · BIND</span>
        <h2>
          {activeSession
            ? "Pick up where you paused."
            : "Three moments. Your perspective."}
        </h2>
        <p>
          {activeSession
            ? `${activeSession.answeredCount} of ${activeSession.totalCount} decisions saved. Your next scenario or debrief is ready.`
            : "Watch the setup, commit to a choice and compare the conditions behind each option."}
        </p>
        <p className="quiet-note">
          Answers and review checkpoints save automatically. Finish the debrief
          to complete your session.
        </p>
      </div>
      <div className="start-actions">
        {activeSession ? (
          <Link
            href={`/play/${activeSession.id}`}
            className="button button-primary"
          >
            Resume session →
          </Link>
        ) : (
          <button
            className="button button-primary"
            onClick={startOrResume}
            disabled={pending}
          >
            {pending
              ? "Opening…"
              : error
                ? "Retry opening session"
                : "Start 3 scenarios →"}
          </button>
        )}
        <Link href="/history" className="text-button">
          View saved sessions
        </Link>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
