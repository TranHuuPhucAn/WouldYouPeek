"use client";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { getAccount } from "@/lib/client/account-api";
import { ApiClientError } from "@/lib/client/api-response";
const RECONCILING_IDENTITY = Symbol("reconciling identity");

export function invalidateAccountView(expectedViewerId?: string | null) {
  window.dispatchEvent(
    new CustomEvent("wyp:identity-invalidated", {
      detail: { expectedViewerId },
    }),
  );
}
export function AuthStateSync({
  viewerId,
  authSnapshotKey,
  children,
}: {
  viewerId: string | null;
  authSnapshotKey?: string;
  children: React.ReactNode;
}) {
  const [invalid, setInvalid] = useState(false);
  const router = useRouter();
  const expectedViewer = useRef<
    string | null | undefined | typeof RECONCILING_IDENTITY
  >(undefined);
  useEffect(() => {
    if (
      expectedViewer.current === undefined ||
      expectedViewer.current === viewerId
    ) {
      setInvalid(false);
      expectedViewer.current = undefined;
    }
  }, [authSnapshotKey, viewerId]);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let authGeneration = 0;
    const invalidate = (event: Event) => {
      if (!disposed) {
        const next = (
          event as CustomEvent<{ expectedViewerId?: string | null }>
        ).detail?.expectedViewerId;
        if (next !== undefined) {
          expectedViewer.current = next;
          authGeneration++;
        }
        setInvalid(true);
        router.refresh();
      }
    };
    const recheckViewer = async (generation: number) => {
      try {
        const account = await getAccount(controller.signal);
        if (disposed || generation !== authGeneration) return;
        if (
          account.id !== viewerId ||
          expectedViewer.current === RECONCILING_IDENTITY
        )
          invalidateAccountView(account.id);
      } catch (error) {
        if (
          disposed ||
          generation !== authGeneration ||
          !(error instanceof ApiClientError)
        )
          return;
        if (error.status === 401) {
          if (viewerId) invalidateAccountView(null);
          else {
            // A browser-stored session may outlive its user or credentials.
            // The server has confirmed this is a guest; keep sign-in usable.
            expectedViewer.current = undefined;
            setInvalid(false);
          }
        } else if (
          error.status === 403 &&
          (viewerId || expectedViewer.current === RECONCILING_IDENTITY)
        ) {
          // An unverified account can still render the verification page.
          expectedViewer.current = undefined;
          invalidateAccountView();
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible")
        void recheckViewer(++authGeneration);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    document.addEventListener("visibilitychange", onVisibilityChange);
    let unsubscribe: (() => void) | undefined;
    try {
      const { data } = createBrowserSupabaseClient().auth.onAuthStateChange(
        (event: AuthChangeEvent, session: Session | null) => {
          if (disposed) return;
          const generation = ++authGeneration;
          const id = session?.user.id ?? null;
          if (event === "SIGNED_OUT") {
            if (viewerId || expectedViewer.current !== undefined)
              invalidateAccountView(null);
          } else if (id !== viewerId) {
            // INITIAL_SESSION and SIGNED_IN can come from stale local storage.
            // Do not require the server to adopt that unverified browser ID.
            expectedViewer.current = RECONCILING_IDENTITY;
            if (viewerId) invalidateAccountView();
            void recheckViewer(generation);
          } else if (event === "TOKEN_REFRESHED")
            void recheckViewer(generation);
        },
      );
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      /* The server renders service configuration failures on protected pages. */
    }
    return () => {
      disposed = true;
      controller.abort();
      unsubscribe?.();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [viewerId, router]);
  if (invalid)
    return (
      <main className="status-panel">
        <h1>Your sign-in has changed.</h1>
        <p>Refreshing your account. Your saved progress is safe.</p>
        <Link href="/sign-in" className="button button-primary">
          Sign in
        </Link>
      </main>
    );
  return children;
}
