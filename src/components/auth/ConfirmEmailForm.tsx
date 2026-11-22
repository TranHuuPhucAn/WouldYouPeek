"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { confirmEmailAction } from "@/app/(auth)/actions";
import { INITIAL_AUTH_STATE } from "@/contracts/auth";

export function ConfirmEmailForm({
  type,
  tokenHash,
  returnTo,
}: {
  type: "signup" | "recovery";
  tokenHash: string;
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState(
    confirmEmailAction,
    INITIAL_AUTH_STATE,
  );
  const message = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status !== "idle") message.current?.focus();
  }, [state]);
  const recovery = type === "recovery";
  return (
    <form
      action={formAction}
      className="auth-form"
      aria-label={recovery ? "Confirm password reset" : "Confirm email"}
    >
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {state.status !== "idle" && (
        <div
          className={`form-message ${state.status}`}
          role={state.status === "error" ? "alert" : "status"}
          tabIndex={-1}
          ref={message}
        >
          {state.message ??
            "This link could not be confirmed. Request a fresh link to continue."}
        </div>
      )}
      <button
        className="button button-primary"
        type="submit"
        disabled={pending}
      >
        {pending
          ? "Please wait…"
          : recovery
            ? "Continue to reset password"
            : "Verify email"}
      </button>
      {state.status === "error" && (
        <Link
          className="text-button"
          href={
            recovery
              ? "/forgot-password"
              : `/check-email?returnTo=${encodeURIComponent(returnTo)}`
          }
        >
          {recovery
            ? "Request a new reset link"
            : "Request a new verification link"}
        </Link>
      )}
      <Link
        className="text-button"
        href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
      >
        Back to sign in
      </Link>
    </form>
  );
}
