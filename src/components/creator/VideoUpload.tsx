"use client";
import { useEffect, useRef, useState } from "react";
import type { VideoAssetSnapshot } from "@/contracts/video";
import { getCreatorVideo } from "@/lib/client/video-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { useVideoUpload } from "@/hooks/use-video-upload";
import { formatUploadLimit } from "@/lib/video/upload-policy";

export function VideoUpload({
  viewerId,
  onVideo,
  resumeVideo = null,
  onBusy,
}: {
  viewerId: string;
  onVideo: (video: VideoAssetSnapshot) => void;
  resumeVideo?: VideoAssetSnapshot | null;
  onBusy?: (busy: boolean) => void;
}) {
  const upload = useVideoUpload(viewerId, onVideo);
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onBusy, upload });
  callbacks.current = { onBusy, upload };
  const busy = ["preparing", "uploading", "confirming", "removing"].includes(
    upload.stage,
  );
  useEffect(() => {
    callbacks.current.onBusy?.(busy);
  }, [busy]);
  useEffect(() => {
    setFile(null);
    if (input.current) input.current.value = "";
  }, [resumeVideo?.id]);
  useEffect(() => {
    const item = upload.video;
    if (!item || !["uploaded", "validating"].includes(item.state)) return;
    let active = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll() {
      if (!active) return;
      try {
        const next = await getCreatorVideo(item!.id, controller.signal);
        if (active) callbacks.current.upload.syncVideo(next);
      } catch (failure) {
        if (
          active &&
          failure instanceof ApiClientError &&
          [401, 403].includes(failure.status)
        ) {
          active = false;
          invalidateAccountView();
          return;
        }
        /* The library refresh remains available if polling is offline. */
      }
      if (active) timer = setTimeout(() => void poll(), 2000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [upload.video?.id, upload.video?.state]);
  if (upload.invalid)
    return <p role="alert">Your session changed. Sign in again to upload.</p>;
  const target = resumeVideo?.state === "pending_upload" ? resumeVideo : null;
  const transferred = upload.video?.byteSize ?? file?.size ?? 0;
  return (
    <section
      className="creator-section video-upload"
      aria-label="Upload a recording"
    >
      <h2>{target ? `Resume ${target.fileName}` : "Upload a recording"}</h2>
      <p>
        MP4 with H.264 video and AAC audio, or no audio. Up to 2 GiB, two hours
        and 1080p. Each recording can support several scenarios.
      </p>
      <p className="quiet-note">
        Up to three unfinished uploads and 10 GiB of recordings per creator.
        Recordings used by published versions stay available for saved learner
        sessions.
      </p>
      {target && (
        <p>
          Reselect the original file. Its contents are checked before resuming
          the saved upload.
        </p>
      )}
      <label htmlFor="creator-video-file">Recording file</label>
      <input
        ref={input}
        id="creator-video-file"
        type="file"
        accept="video/mp4,.mp4"
        disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      {file && (
        <p>
          {file.name} · {formatUploadLimit(file.size)}
        </p>
      )}
      {upload.selectedFileName && !file && (
        <p>Selected recording: {upload.selectedFileName}</p>
      )}
      <div className="creator-save-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={
            !file ||
            busy ||
            (upload.video?.state !== "pending_upload" &&
              !!upload.video &&
              !target)
          }
          onClick={() => file && void upload.start(file, target ?? undefined)}
        >
          {target || upload.video?.state === "pending_upload"
            ? "Resume upload"
            : "Start upload"}
        </button>
        {["uploading", "preparing"].includes(upload.stage) && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void upload.pause()}
          >
            Pause upload
          </button>
        )}
        {upload.video?.state === "pending_upload" &&
          upload.stage === "paused" &&
          upload.hasSelectedFile && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void upload.resume()}
            >
              Continue selected upload
            </button>
          )}
        {upload.video &&
          [
            "pending_upload",
            "uploaded",
            "validating",
            "rejected",
            "deleting",
          ].includes(upload.video.state) && (
            <button
              type="button"
              className="text-button"
              disabled={
                upload.stage === "confirming" || upload.stage === "removing"
              }
              onClick={() => {
                if (
                  window.confirm(
                    "Cancel this upload and remove its unused recording?",
                  )
                )
                  void upload.cancel();
              }}
            >
              Cancel upload
            </button>
          )}
        {upload.stage === "error" &&
          upload.bytes === upload.video?.byteSize && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void upload.retryComplete()}
            >
              Retry completion confirmation
            </button>
          )}
        {upload.video &&
          ["ready", "rejected", "deleted"].includes(upload.video.state) && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                upload.reset();
                setFile(null);
                if (input.current) input.current.value = "";
              }}
            >
              Choose another recording
            </button>
          )}
      </div>
      {upload.stage === "preparing" && (
        <div role="status">
          <p>Checking the selected file for safe upload recovery…</p>
          <progress
            aria-label="File check progress"
            max={file?.size ?? 1}
            value={upload.preparedBytes}
          />
        </div>
      )}
      {["uploading", "paused", "confirming"].includes(upload.stage) && (
        <div role="status">
          <progress
            aria-label="Upload progress"
            max={transferred || 1}
            value={upload.bytes}
          />
          <p>
            {formatUploadLimit(upload.bytes)} of{" "}
            {formatUploadLimit(transferred)} ·{" "}
            {upload.stage === "paused"
              ? "Paused"
              : upload.stage === "confirming"
                ? "Confirming transfer"
                : "Uploading"}
          </p>
        </div>
      )}
      {upload.stage === "removing" && (
        <p role="status">Removing the unused recording…</p>
      )}
      {upload.stage === "checking" && (
        <p role="status">
          Checking the uploaded file’s format and playback details. You can
          leave this page and return to Your videos.
        </p>
      )}
      {upload.stage === "ready" && (
        <p role="status">
          Recording ready. Select it in a scenario’s source field and mark your
          own decision moment.
        </p>
      )}
      {upload.error && (
        <p role="alert" className="field-error">
          {upload.error}
        </p>
      )}
      {upload.hasPendingReservation && (
        <p className="quiet-note">
          A previous reservation is being recovered. Keep the original file
          until its status is confirmed.
        </p>
      )}
    </section>
  );
}
