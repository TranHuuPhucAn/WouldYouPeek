"use client";
import { useEffect, useRef, useState } from "react";
import type { PlaybackAccess, PlaybackContext } from "@/contracts/video";
import { getPlaybackAccess } from "@/lib/client/video-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";

/** URLs live only in memory. Renewing access must not mutate a learner session. */
export function useUploadedPlayback(
  context: PlaybackContext | null,
  assetId: string | null,
  beforeReplace?: () => void,
) {
  const contextKey = context ? JSON.stringify(context) : "";
  const capabilityKey = JSON.stringify([contextKey, assetId]);
  const [capability, setCapability] = useState<{
    key: string;
    value: PlaybackAccess;
  } | null>(null);
  // A prior item's URL must not paint while its successor is authorizing,
  // even when both items refer to the same underlying uploaded recording.
  const access = capability?.key === capabilityKey ? capability.value : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const replaceRef = useRef(beforeReplace);
  replaceRef.current = beforeReplace;
  const accessRef = useRef(access);
  accessRef.current = access;
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let invalidated = false;
    setInvalid(false);
    setError(null);
    if (!assetId || !contextKey) {
      setCapability(null);
      setLoading(false);
      return;
    }
    if (accessRef.current?.assetId !== assetId) setCapability(null);
    async function refresh() {
      if (!active || invalidated || controller) return;
      clearTimeout(timer);
      controller = new AbortController();
      const request = controller;
      setLoading(true);
      setError(null);
      try {
        const next = await getPlaybackAccess(
          JSON.parse(contextKey) as PlaybackContext,
          assetId!,
          request.signal,
        );
        if (!active || request.signal.aborted) return;
        if (Date.parse(next.expiresAt) <= Date.now() + 1000)
          throw new Error(
            "Playback access expired before it could be used. Retry playback.",
          );
        if (accessRef.current?.url !== next.url) replaceRef.current?.();
        setCapability({ key: capabilityKey, value: next });
        timer = setTimeout(
          () => void refresh(),
          Math.max(1000, Date.parse(next.expiresAt) - Date.now() - 15000),
        );
      } catch (failure) {
        if (!active || request.signal.aborted) return;
        if (
          failure instanceof ApiClientError &&
          [401, 403].includes(failure.status)
        ) {
          invalidated = true;
          setCapability(null);
          setInvalid(true);
          invalidateAccountView();
        }
        setError(
          failure instanceof Error
            ? failure.message
            : "This recording could not be loaded. Retry playback.",
        );
      } finally {
        if (controller === request) controller = null;
        if (active) setLoading(false);
      }
    }
    refreshRef.current = refresh;
    function invalidate() {
      replaceRef.current?.();
      invalidated = true;
      controller?.abort();
      clearTimeout(timer);
      setCapability(null);
      setLoading(false);
      setInvalid(true);
      setError("Your session changed. Sign in again to play this recording.");
    }
    window.addEventListener("wyp:identity-invalidated", invalidate);
    void refresh();
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(timer);
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [contextKey, assetId, capabilityKey]);
  return {
    access,
    loading,
    error,
    invalid,
    refresh: () => refreshRef.current(),
  };
}
