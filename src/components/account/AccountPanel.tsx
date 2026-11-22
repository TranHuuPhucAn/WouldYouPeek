"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountUser } from "@/contracts/auth";
import { ApiClientError } from "@/lib/client/api-response";
import { enableCreatorAccess } from "@/lib/client/account-api";
import { signOutAction } from "@/app/(auth)/actions";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function AccountPanel({
  viewer,
  operatorAccess = false,
  operatorAccessUnavailable = false,
}: {
  viewer: AccountUser;
  operatorAccess?: boolean;
  operatorAccessUnavailable?: boolean;
}) {
  const [account, setAccount] = useState(viewer);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const router = useRouter();
  useEffect(() => () => request.current?.abort(), []);
  async function enable() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await enableCreatorAccess(controller.signal);
      if (!controller.signal.aborted && next.id !== viewer.id) {
        invalidateAccountView(next.id);
        return;
      }
      if (!controller.signal.aborted && next.id === viewer.id) {
        setAccount(next);
        router.refresh();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      setError("Creator access couldn’t be enabled. Please try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  return (
    <div className="account-grid">
      <section className="surface-card">
        <span className="eyebrow">YOUR ACCOUNT</span>
        <h2>{account.email}</h2>
        <p>
          Verified email ·{" "}
          {account.role === "creator" ? "Creator and learner" : "Learner"}
        </p>
        <p>Your saved sessions are available whenever you sign in.</p>
        <div className="card-actions">
          <Link className="text-button" href="/reset-password">
            Change password
          </Link>
          <form
            action={async () => {
              invalidateAccountView(null);
              await signOutAction();
            }}
          >
            <button className="button button-secondary">Sign out</button>
          </form>
        </div>
      </section>
      <section className="surface-card">
        <span className="eyebrow">CREATOR ACCESS</span>
        <h2>
          {account.role === "creator"
            ? "You’re ready to create."
            : "Bring your perspective."}
        </h2>
        <p>
          Enable creator access for your account. You keep all learner features
          and saved sessions.
        </p>
        <p className="quiet-note">
          Turn a video moment into a scenario, review every choice, and publish
          it to the learner library.
        </p>
        {account.role === "creator" ? (
          <Link href="/creator" className="button button-primary">
            Open creator space →
          </Link>
        ) : (
          <button
            className="button button-primary"
            onClick={enable}
            disabled={pending}
          >
            {pending ? "Enabling…" : "Enable creator access"}
          </button>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </section>
      {operatorAccess && viewer.emailVerified && account.emailVerified && (
        <section className="surface-card">
          <span className="eyebrow">OPERATOR</span>
          <h2>Review scenario reports.</h2>
          <p>Review reported moments and manage their public visibility.</p>
          <Link href="/operator/reports" className="button button-secondary">
            Review scenario reports →
          </Link>
        </section>
      )}
      {operatorAccessUnavailable && (
        <p role="status">
          Operator access couldn’t be checked. Refresh to try again.
        </p>
      )}
    </div>
  );
}
