"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountUser } from "@/contracts/auth";
import type { SessionSummary } from "@/contracts/session";
import { createOrResumeSession } from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function ScenarioStart({
  scenarioId,
  viewer,
}: {
  scenarioId: string;
  viewer: AccountUser | null;
}) {
  const router = useRouter(),
    requestId = useRef<string | null>(null),
    request = useRef<AbortController | null>(null),
    valid = useRef(true);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [active, setActive] = useState<SessionSummary | null>(null),
    [unavailable, setUnavailable] = useState(false),
    [identityChanged, setIdentityChanged] = useState(false);
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      setActive(null);
      setIdentityChanged(true);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [scenarioId]);
  async function startScenario() {
    if (request.current || !valid.current || !viewer?.emailVerified) return;
    const controller = new AbortController();
    request.current = controller;
    requestId.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    setActive(null);
    try {
      const response = await createOrResumeSession(
        {
          requestId: requestId.current,
          target: { kind: "scenario", scenarioId },
        },
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        router.push(`/play/${response.session.id}`);
    } catch (error) {
      if (controller.signal.aborted || !valid.current) return;
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      if (
        error instanceof ApiClientError &&
        error.code === "ACTIVE_SESSION_EXISTS"
      ) {
        setActive(
          error.details && "activeSession" in error.details
            ? error.details.activeSession
            : null,
        );
        setError("Finish your current session before starting this scenario.");
        requestId.current = null;
      } else if (
        error instanceof ApiClientError &&
        error.code === "SCENARIO_UNAVAILABLE"
      ) {
        setUnavailable(true);
        setError(
          "This scenario is no longer available for new sessions. Your saved sessions remain available.",
        );
      } else
        setError(
          "We couldn’t confirm the start. Retry to recover the same session.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section className="scenario-start surface-card">
      <h2>Your next call.</h2>
      <p>
        One scenario. Commit your choice, watch the continuation, then question
        the analysis.
      </p>
      {identityChanged ? (
        <p role="status">Your sign-in changed. Refreshing…</p>
      ) : !viewer?.emailVerified ? (
        <Link
          className="button button-primary"
          href={`${viewer ? "/check-email" : "/sign-in"}?returnTo=${encodeURIComponent(`/library/${scenarioId}`)}`}
        >
          {viewer ? "Verify email to play →" : "Sign in to play →"}
        </Link>
      ) : (
        !active &&
        !unavailable && (
          <button
            className="button button-primary"
            disabled={pending}
            onClick={() => void startScenario()}
          >
            {pending
              ? "Opening…"
              : error
                ? "Retry starting scenario"
                : "Start scenario →"}
          </button>
        )
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {active && (
        <>
          <p>
            {active.title} · {active.answeredCount}/{active.totalCount}{" "}
            decisions saved.
          </p>
          <Link className="button button-primary" href={`/play/${active.id}`}>
            Resume current session →
          </Link>
        </>
      )}
      {error && !active && !unavailable && (
        <Link href="/history" className="text-button">
          View saved sessions
        </Link>
      )}
      <Link href="/library" className="text-button">
        Back to library
      </Link>
    </section>
  );
}
