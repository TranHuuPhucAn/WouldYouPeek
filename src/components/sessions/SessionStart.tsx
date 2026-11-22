"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountUser } from "@/contracts/auth";
import type {
  SessionSummary,
  SessionSnapshot,
  SessionTarget,
  StartSessionRequest,
} from "@/contracts/session";
import { createOrResumeSession, getSession } from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { ActiveSessionEndControl } from "./ActiveSessionEndControl";
type SessionStartProps = {
  target: Exclude<SessionTarget, { kind: "demo" }>;
  expectedPublicationVersion?: string;
  viewer: AccountUser | null;
  returnTo: string;
};
export function SessionStart(props: SessionStartProps) {
  // A refreshed preview or account change is a new start context. Never reuse
  // an uncertain command from a previously rendered publication or account.
  const context = JSON.stringify([
    props.viewer?.id,
    props.viewer?.emailVerified,
    props.target,
    props.expectedPublicationVersion,
  ]);
  return <SessionStartState key={context} {...props} />;
}
function SessionStartState({
  target,
  expectedPublicationVersion,
  viewer,
  returnTo,
}: SessionStartProps) {
  const playlist = target.kind === "playlist";
  const identity = JSON.stringify(target);
  const command = useRef<StartSessionRequest | null>(null);
  const [changed, setChanged] = useState(false);
  const [activeSnapshot, setActiveSnapshot] = useState<SessionSnapshot | null>(
    null,
  );
  const [closed, setClosed] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (closed) startButton.current?.focus();
  }, [closed]);
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
      setActiveSnapshot(null);
      setIdentityChanged(true);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [identity, viewer?.id]);
  async function startScenario() {
    if (request.current || !valid.current || !viewer?.emailVerified) return;
    const controller = new AbortController();
    request.current = controller;
    requestId.current ??= crypto.randomUUID();
    command.current ??=
      target.kind === "playlist"
        ? {
            requestId: requestId.current,
            target,
            expectedPublicationVersion: expectedPublicationVersion!,
          }
        : { requestId: requestId.current, target };
    setPending(true);
    setError(null);
    setActive(null);
    setActiveSnapshot(null);
    setClosed(false);
    try {
      const response = await createOrResumeSession(
        command.current,
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
        setError(
          `Resume or end your current session before starting this ${playlist ? "playlist" : "scenario"}.`,
        );
        command.current = null;
        requestId.current = null;
      } else if (
        error instanceof ApiClientError &&
        ["SCENARIO_UNAVAILABLE", "PLAYLIST_UNAVAILABLE"].includes(error.code)
      ) {
        setUnavailable(true);
        setError(
          `This ${playlist ? "playlist" : "scenario"} is no longer available for new sessions. Your saved sessions remain available.`,
        );
      } else if (
        error instanceof ApiClientError &&
        error.code === "PLAYLIST_CHANGED"
      ) {
        setChanged(true);
        command.current = null;
        requestId.current = null;
        setError(
          "This playlist has changed. Refresh the preview before starting.",
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
  async function loadActiveSessionForEnd() {
    if (request.current || !valid.current || !viewer?.emailVerified || !active)
      return;
    const activeId = active.id;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const snapshot = await getSession(activeId, controller.signal);
      if (controller.signal.aborted || !valid.current) return;
      if (snapshot.status !== "in_progress") handleSessionEnded(activeId);
      else setActiveSnapshot(snapshot);
    } catch (error) {
      if (controller.signal.aborted || !valid.current) return;
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      setError(
        "Your current session couldn’t be checked. Retry before ending it.",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  function handleSessionEnded(id: string) {
    if (!valid.current || active?.id !== id) return;
    setActive(null);
    setActiveSnapshot(null);
    setError(null);
    setClosed(true);
  }
  return (
    <section className="scenario-start surface-card">
      <h2>{playlist ? "Your next session." : "Your next call."}</h2>
      <p>
        {playlist
          ? "Play every scenario in the order shown. Your decisions and progress are saved."
          : "One scenario. Commit your choice, watch the continuation, then question the analysis."}
      </p>
      {identityChanged ? (
        <p role="status">Your sign-in changed. Refreshing…</p>
      ) : !viewer?.emailVerified ? (
        <Link
          className="button button-primary"
          href={`${viewer ? "/check-email" : "/sign-in"}?returnTo=${encodeURIComponent(returnTo)}`}
        >
          {viewer ? "Verify email to play →" : "Sign in to play →"}
        </Link>
      ) : (
        !active &&
        !unavailable &&
        !changed && (
          <button
            ref={startButton}
            className="button button-primary"
            disabled={pending}
            onClick={() => void startScenario()}
          >
            {pending
              ? "Opening…"
              : error
                ? `Retry starting ${playlist ? "playlist" : "scenario"}`
                : `Start ${playlist ? "playlist" : "scenario"} →`}
          </button>
        )
      )}
      {changed && (
        <a className="button button-secondary" href={returnTo}>
          Refresh playlist preview
        </a>
      )}
      {closed && (
        <p role="status">
          Your previous session is closed. Saved decisions remain in History.
          Start this {playlist ? "playlist" : "scenario"} when you’re ready.
        </p>
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
          {activeSnapshot && viewer ? (
            <ActiveSessionEndControl
              key={activeSnapshot.id}
              snapshot={activeSnapshot}
              viewerId={viewer.id}
              onEnded={handleSessionEnded}
            />
          ) : (
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => void loadActiveSessionForEnd()}
            >
              {pending ? "Checking saved session…" : "End current session"}
            </button>
          )}
        </>
      )}
      {error && !active && !changed && (
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
