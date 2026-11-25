"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CreateVideoRequest,
  VideoAssetSnapshot,
  VideoCommand,
} from "@/contracts/video";
import {
  completeCreatorVideo,
  createCreatorVideo,
  deleteCreatorVideo,
  findCreatorVideoByRequestId,
  getCreatorVideo,
  getUploadSession,
} from "@/lib/client/video-api";
import { validateVideoContinuity } from "@/lib/client/video-validation";
import { ApiClientError } from "@/lib/client/api-response";
import { isUuid } from "@/lib/client/session-api";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import {
  createUploadTransport,
  fingerprintVideo,
  type UploadTransport,
} from "@/lib/video/upload-transport";
import { validateUploadSelection } from "@/lib/video/upload-policy";

export type UploadStage =
  | "idle"
  | "preparing"
  | "uploading"
  | "paused"
  | "confirming"
  | "removing"
  | "checking"
  | "ready"
  | "error";
type Recovery = { version: 1; viewerId: string; request: CreateVideoRequest };
export function useVideoUpload(
  viewerId: string,
  onVideo: (video: VideoAssetSnapshot) => void,
) {
  const [stage, setStage] = useState<UploadStage>("idle"),
    [video, setVideo] = useState<VideoAssetSnapshot | null>(null);
  const [bytes, setBytes] = useState(0),
    [preparedBytes, setPreparedBytes] = useState(0),
    [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false),
    [hasPendingReservation, setHasPendingReservation] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const current = useRef(video);
  current.current = video;
  const callbacks = useRef(onVideo);
  callbacks.current = onVideo;
  const selected = useRef<File | null>(null),
    transport = useRef<UploadTransport | null>(null);
  const request = useRef<AbortController | null>(null),
    reservation = useRef<CreateVideoRequest | null>(null);
  const completion = useRef<VideoCommand | null>(null),
    deletion = useRef<VideoCommand | null>(null);
  const alive = useRef(true),
    epoch = useRef(0),
    transferring = useRef(false),
    removing = useRef(false);
  const key = `wyp:video-reservation:v1:${viewerId}`;
  function clearRecovery() {
    reservation.current = null;
    try {
      sessionStorage.removeItem(key);
    } catch {}
    setHasPendingReservation(false);
  }
  function remember(input: CreateVideoRequest) {
    reservation.current = input;
    setHasPendingReservation(true);
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          viewerId,
          request: input,
        } satisfies Recovery),
      );
    } catch {}
  }
  function accept(next: VideoAssetSnapshot) {
    if (current.current?.id === next.id)
      validateVideoContinuity(next, current.current);
    current.current = next;
    setVideo(next);
    callbacks.current(next);
  }
  function stageFor(next: VideoAssetSnapshot): UploadStage {
    if (next.state === "ready") return "ready";
    if (next.state === "pending_upload") return "paused";
    if (
      next.state === "rejected" ||
      next.state === "deleting" ||
      next.state === "deleted"
    ) {
      setError(
        next.failure?.message ??
          (next.state === "rejected"
            ? "This recording could not be validated."
            : "This recording is being removed."),
      );
      return "error";
    }
    return "checking";
  }
  function authFailure(failure: unknown) {
    if (
      failure instanceof ApiClientError &&
      [401, 403].includes(failure.status)
    ) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      alive.current = false;
      transferring.current = false;
      epoch.current++;
      request.current?.abort();
      void transport.current?.abort();
      selected.current = null;
      current.current = null;
      reservation.current = null;
      completion.current = null;
      deletion.current = null;
      setVideo(null);
      setSelectedFileName(null);
      setInvalid(true);
      clearRecovery();
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    let recovery: Recovery | null = null;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as Recovery;
        if (
          parsed.version === 1 &&
          parsed.viewerId === viewerId &&
          isUuid(parsed.request?.requestId) &&
          typeof parsed.request.fileName === "string" &&
          parsed.request.fileName.length > 0 &&
          parsed.request.fileName.length <= 255 &&
          Number.isSafeInteger(parsed.request.byteSize) &&
          parsed.request.byteSize > 0 &&
          parsed.request.byteSize <= 2 * 1024 ** 3 &&
          parsed.request.mimeType === "video/mp4" &&
          Object.keys(parsed.request).every((field) =>
            [
              "requestId",
              "fileName",
              "byteSize",
              "mimeType",
              "contentFingerprint",
            ].includes(field),
          ) &&
          /^[a-f0-9]{64}$/.test(parsed.request?.contentFingerprint ?? "")
        )
          recovery = parsed;
        else sessionStorage.removeItem(key);
      }
    } catch {
      try {
        sessionStorage.removeItem(key);
      } catch {}
      /* Recovery storage is optional; server library remains authoritative. */
    }
    const controller = new AbortController();
    const recoveryEpoch = epoch.current;
    if (recovery) {
      reservation.current = recovery.request;
      setHasPendingReservation(true);
      void findCreatorVideoByRequestId(
        recovery.request.requestId,
        controller.signal,
      )
        .then((found) => {
          if (
            !alive.current ||
            controller.signal.aborted ||
            recoveryEpoch !== epoch.current
          )
            return;
          if (found) {
            accept(found);
            clearRecovery();
            setStage(stageFor(found));
          } else {
            setError(
              "Reselect the original recording to safely retry the pending upload reservation.",
            );
            setStage("error");
          }
        })
        .catch((failure) => {
          if (
            alive.current &&
            !controller.signal.aborted &&
            recoveryEpoch === epoch.current &&
            !authFailure(failure)
          ) {
            setError(
              "The previous upload could not be checked. Reselect the original file to retry the same reservation.",
            );
            setStage("error");
          }
        });
    }
    return () => {
      alive.current = false;
      epoch.current++;
      request.current?.abort();
      controller.abort();
      void transport.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [viewerId]);

  async function confirmUpload() {
    const item = current.current;
    if (!item || request.current || !alive.current) return;
    const controller = new AbortController();
    request.current = controller;
    completion.current ??= {
      requestId: crypto.randomUUID(),
      expectedRevision: item.revision,
    };
    setStage("confirming");
    setError(null);
    try {
      const result = await completeCreatorVideo(
        item.id,
        completion.current,
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      accept(result.video);
      completion.current = null;
      setStage(stageFor(result.video));
    } catch (failure) {
      if (!alive.current || controller.signal.aborted || authFailure(failure))
        return;
      try {
        const latest = await getCreatorVideo(item.id, controller.signal);
        if (!alive.current || controller.signal.aborted) return;
        accept(latest);
        if (failure instanceof ApiClientError && failure.status === 409)
          completion.current = null;
        if (latest.state !== "pending_upload") {
          completion.current = null;
          setStage(stageFor(latest));
          return;
        }
      } catch (reconciliationFailure) {
        if (authFailure(reconciliationFailure)) return;
        /* Retain the original completion command after an unknown result. */
      }
      setStage("error");
      setError(
        "Upload transferred, but completion is not confirmed. Retry confirmation safely.",
      );
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  async function start(file: File, existing?: VideoAssetSnapshot) {
    if (request.current || !alive.current || transferring.current) return;
    if (reservation.current && !current.current && existing) {
      setError(
        "A previous reservation is unconfirmed. Reselect its original recording first.",
      );
      setStage("error");
      return;
    }
    if (existing && existing.id !== current.current?.id) {
      completion.current = null;
      deletion.current = null;
    }
    const problems = validateUploadSelection(file);
    if (problems.length) {
      setError(problems[0]);
      setStage("error");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    const ownEpoch = ++epoch.current;
    const valid = () =>
      alive.current && !controller.signal.aborted && ownEpoch === epoch.current;
    selected.current = file;
    setSelectedFileName(file.name);
    setStage("preparing");
    setPreparedBytes(0);
    setError(null);
    try {
      const fingerprint = await fingerprintVideo(
        file,
        controller.signal,
        (count) => {
          if (valid()) setPreparedBytes(count);
        },
      );
      if (!valid()) return;
      let item = existing ?? current.current;
      if (item && item.state !== "pending_upload")
        throw new Error(
          "Choose Resume on an unfinished upload, or start a new recording.",
        );
      if (
        item &&
        (item.contentFingerprint !== fingerprint ||
          item.byteSize !== file.size ||
          item.fileName !== file.name)
      )
        throw new Error(
          "This is a different file. Reselect the original recording to resume it.",
        );
      if (!item) {
        const pending = reservation.current;
        if (
          pending &&
          (pending.contentFingerprint !== fingerprint ||
            pending.byteSize !== file.size ||
            pending.fileName !== file.name)
        )
          throw new Error(
            "A previous reservation is unconfirmed. Reselect its original recording before starting another.",
          );
        const input = pending ?? {
          requestId: crypto.randomUUID(),
          fileName: file.name,
          byteSize: file.size,
          mimeType: "video/mp4" as const,
          contentFingerprint: fingerprint,
        };
        remember(input);
        const response = await createCreatorVideo(input, controller.signal);
        if (!valid()) return;
        item = response.video;
        accept(item);
        clearRecovery();
        reservation.current = null;
      } else accept(item);
      if (item.state !== "pending_upload") {
        setStage(stageFor(item));
        return;
      }
      const session = await getUploadSession(item.id, controller.signal);
      if (!valid()) return;
      accept(session.video);
      const transfer = await createUploadTransport(
        file,
        session.upload,
        viewerId,
        {
          onProgress: (count) => {
            if (alive.current && ownEpoch === epoch.current) {
              setBytes(count);
              setStage("uploading");
            }
          },
          onSuccess: () => {
            if (alive.current && ownEpoch === epoch.current) {
              transferring.current = false;
              setBytes(file.size);
              void confirmUpload();
            }
          },
          onError: (message) => {
            if (alive.current && ownEpoch === epoch.current) {
              transferring.current = false;
              setError(message);
              setStage("error");
            }
          },
        },
      );
      if (!valid()) {
        await transfer.abort();
        return;
      }
      transport.current = transfer;
      transferring.current = true;
      request.current = null;
      setStage("uploading");
      transfer.start();
    } catch (failure) {
      if (valid() && !authFailure(failure)) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The upload could not start.",
        );
        setStage("error");
      }
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  async function pause() {
    if (!alive.current) return;
    transferring.current = false;
    request.current?.abort();
    request.current = null;
    await transport.current?.pause();
    if (alive.current) setStage("paused");
  }
  async function cancel() {
    if (!alive.current || removing.current) return;
    removing.current = true;
    setStage("removing");
    transferring.current = false;
    epoch.current++;
    request.current?.abort();
    request.current = null;
    await transport.current?.abort().catch(() => {});
    transport.current = null;
    const item = current.current;
    if (!item) {
      removing.current = false;
      setStage("error");
      setError(
        "The upload reservation may still be pending. Reselect its original file to reconcile it before cancelling.",
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    deletion.current ??= {
      requestId: crypto.randomUUID(),
      expectedRevision: item.revision,
    };
    try {
      const result = await deleteCreatorVideo(
        item.id,
        deletion.current,
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      accept(result.video);
      if (result.video.state === "deleted") {
        deletion.current = null;
        completion.current = null;
        selected.current = null;
        current.current = null;
        setVideo(null);
        setSelectedFileName(null);
        setStage("idle");
        setError(null);
        clearRecovery();
      } else {
        setStage("error");
        setError(
          "Removal is still in progress. Retry cancellation to confirm it.",
        );
      }
    } catch (failure) {
      if (
        alive.current &&
        !controller.signal.aborted &&
        !authFailure(failure)
      ) {
        if (failure instanceof ApiClientError && failure.status === 409) {
          deletion.current = null;
          try {
            const latest = await getCreatorVideo(item.id, controller.signal);
            if (alive.current && !controller.signal.aborted) accept(latest);
          } catch (reconciliationFailure) {
            if (authFailure(reconciliationFailure)) return;
          }
        }
        if (!alive.current || controller.signal.aborted) return;
        setStage("error");
        setError(
          failure instanceof Error
            ? failure.message
            : "Removal could not be confirmed. Retry cancellation.",
        );
      }
    } finally {
      removing.current = false;
      if (request.current === controller) request.current = null;
    }
  }
  function reset() {
    if (request.current || stage === "uploading" || hasPendingReservation)
      return;
    epoch.current++;
    void transport.current?.abort();
    transport.current = null;
    selected.current = null;
    current.current = null;
    completion.current = null;
    deletion.current = null;
    reservation.current = null;
    setVideo(null);
    setStage("idle");
    setError(null);
    setBytes(0);
    setPreparedBytes(0);
    setSelectedFileName(null);
  }
  return {
    stage,
    video,
    bytes,
    preparedBytes,
    error,
    invalid,
    hasPendingReservation,
    selectedFileName,
    start,
    pause,
    cancel,
    reset,
    retryComplete: confirmUpload,
    resume: () => (selected.current ? start(selected.current) : undefined),
    hasSelectedFile: !!selected.current,
    syncVideo: (next: VideoAssetSnapshot) => {
      if (current.current?.id === next.id) {
        accept(next);
        if (next.state === "ready") setStage("ready");
        else if (next.state === "rejected") {
          setStage("error");
          setError(
            next.failure?.message ?? "This recording could not be validated.",
          );
        }
      }
    },
  };
}
