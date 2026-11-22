"use client";

import { useEffect, useRef, useState } from "react";
import { loadTurnstile, type TurnstileApi } from "@/lib/auth/turnstile";

export function AuthChallenge({
  siteKey,
  onToken,
  resetKey,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<
    "loading" | "ready" | "verified" | "expired" | "error"
  >("loading");
  useEffect(() => {
    let active = true;
    let api: TurnstileApi | undefined;
    let widget: string | undefined;
    onToken(null);
    setStatus("loading");
    const clear = (next: "expired" | "error") => {
      if (!active) return;
      onToken(null);
      setStatus(next);
    };
    void loadTurnstile()
      .then((provider) => {
        if (!active || !container.current) return;
        api = provider;
        setStatus("ready");
        widget = api.render(container.current, {
          sitekey: siteKey,
          theme: "auto",
          size: "compact",
          "response-field": false,
          callback: (token) => {
            if (!active) return;
            onToken(token);
            setStatus("verified");
          },
          "expired-callback": () => clear("expired"),
          "timeout-callback": () => clear("expired"),
          "error-callback": () => clear("error"),
        });
      })
      .catch(() => clear("error"));
    return () => {
      active = false;
      if (widget !== undefined) api?.remove(widget);
    };
  }, [siteKey, onToken, resetKey, attempt]);

  return (
    <div className="auth-challenge">
      <div ref={container} />
      <p className="quiet-note" role="status">
        {status === "loading"
          ? "Loading security check…"
          : status === "verified"
            ? "Security check complete."
            : status === "expired"
              ? "The security check expired. Complete a new check to continue."
              : status === "error"
                ? "The security check couldn’t load. Check your connection or allow challenges.cloudflare.com, then retry."
                : "Complete the security check to continue."}
      </p>
      {(status === "error" || status === "expired") && (
        <button
          type="button"
          className="text-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry security check
        </button>
      )}
    </div>
  );
}
