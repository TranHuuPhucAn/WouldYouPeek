"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SessionSnapshot } from "@/contracts/session";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import { EndSessionDialog } from "./EndSessionDialog";
import { SessionPersistenceNotice } from "./SessionPersistenceNotice";

export function ActiveSessionEndControl({
  snapshot,
  viewerId,
  onEnded,
}: {
  snapshot: SessionSnapshot;
  viewerId: string;
  onEnded: (sessionId: string) => void;
}) {
  const session = useChallengeSession(snapshot, viewerId);
  const { state } = session;
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const finish = useRef<HTMLAnchorElement>(null);
  const announced = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const answered = state.snapshot.items.filter((item) => item.answer).length;
  const terminal = state.snapshot.status !== "in_progress";
  useEffect(() => {
    if (!terminal && answered === state.snapshot.items.length)
      finish.current?.focus();
  }, [terminal, answered, state.snapshot.items.length]);
  useEffect(() => {
    if (terminal && !announced.current) {
      announced.current = true;
      onEndedRef.current(state.snapshot.id);
    }
  }, [terminal, state.snapshot.id]);
  if (state.phase === "auth-required")
    return (
      <p role="status">Your sign-in changed. Refresh this page to continue.</p>
    );
  if (terminal)
    return (
      <p role="status">
        The previous session is closed. Its saved decisions remain in History.
      </p>
    );
  if (answered === state.snapshot.items.length)
    return (
      <p>
        Every decision in your current session is saved.{" "}
        <Link
          ref={finish}
          href={`/play/${state.snapshot.id}`}
          className="text-button"
        >
          Finish current session
        </Link>
      </p>
    );
  return (
    <div className="active-session-end" tabIndex={-1}>
      {(state.pending || state.error) && (
        <SessionPersistenceNotice
          pending={state.pending}
          error={state.error}
          unresolved={state.unresolved}
          onRetry={session.retrySave}
          ending
        />
      )}
      <button
        ref={trigger}
        className="button button-secondary"
        disabled={state.pending || state.unresolved}
        onClick={() => setOpen(true)}
      >
        End current session
      </button>
      <EndSessionDialog
        open={open}
        answeredCount={answered}
        totalCount={state.snapshot.items.length}
        pending={state.pending}
        unresolved={state.unresolved}
        error={state.error}
        returnFocusRef={trigger}
        onClose={() => setOpen(false)}
        onRetry={session.retrySave}
        onConfirm={() => void session.endSessionEarly(state.snapshot.revision)}
      />
    </div>
  );
}
