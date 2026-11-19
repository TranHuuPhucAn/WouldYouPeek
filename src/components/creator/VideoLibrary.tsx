"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  VideoAssetSnapshot,
  VideoCommand,
  VideoListResponse,
} from "@/contracts/video";
import type { SaveDraftRequest } from "@/contracts/creator";
import {
  deleteCreatorVideo,
  getCreatorVideo,
  listCreatorVideos,
  retryVideoValidation,
} from "@/lib/client/video-api";
import {
  createCreatorScenario,
  saveCreatorScenario,
} from "@/lib/client/creator-api";
import { createUploadedSource } from "@/lib/creator/content";
import { formatUploadLimit } from "@/lib/video/upload-policy";
import { formatTimestampInput } from "@/lib/creator/timestamps";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { VideoUpload } from "./VideoUpload";

const stateLabels: Record<VideoAssetSnapshot["state"], string> = {
  pending_upload: "Waiting for upload",
  uploaded: "Waiting for file check",
  validating: "Checking file",
  ready: "Ready",
  rejected: "File needs attention",
  deleting: "Removing",
  deleted: "Removed",
};
export function VideoLibrary({
  initial,
  viewerId,
}: {
  initial: VideoListResponse;
  viewerId: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial),
    [busy, setBusy] = useState(false),
    [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [invalid, setInvalid] = useState(false),
    [resume, setResume] = useState<VideoAssetSnapshot | null>(null);
  const [rowPending, setRowPending] = useState<string | null>(null);
  const alive = useRef(true),
    current = useRef(list);
  current.current = list;
  const request = useRef<AbortController | null>(null),
    mutation = useRef<AbortController | null>(null);
  const commands = useRef(new Map<string, VideoCommand>());
  const creates = useRef(
    new Map<
      string,
      { requestId: string; scenarioId?: string; save?: SaveDraftRequest }
    >(),
  );
  function updated(video: VideoAssetSnapshot) {
    if (!alive.current) return;
    setList((value) => {
      const previous = value.videos.find((item) => item.id === video.id);
      if (previous && previous.revision > video.revision) return value;
      return {
        ...value,
        videos: previous
          ? value.videos.map((item) => (item.id === video.id ? video : item))
          : [video, ...value.videos],
      };
    });
    setResume((value) =>
      value?.id === video.id && video.state !== "pending_upload" ? null : value,
    );
  }
  function fail(failure: unknown) {
    if (
      failure instanceof ApiClientError &&
      [401, 403].includes(failure.status)
    ) {
      invalidateAccountView();
      return;
    }
    setError(
      failure instanceof Error
        ? failure.message
        : "The recording could not be updated. Please retry.",
    );
  }
  async function loadMore(cursor: string | null = null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const next = await listCreatorVideos(cursor, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      setList((old) =>
        cursor
          ? {
              ...next,
              videos: [
                ...new Map(
                  [...old.videos, ...next.videos].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ],
            }
          : next,
      );
    } catch (failure) {
      if (!controller.signal.aborted && alive.current) fail(failure);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!alive.current) return;
      if (!document.hidden)
        await Promise.all(
          current.current.videos
            .filter((item) =>
              ["uploaded", "validating", "deleting"].includes(item.state),
            )
            .map(async (item) => {
              try {
                const next = await getCreatorVideo(item.id, controller.signal);
                if (
                  alive.current &&
                  !controller.signal.aborted &&
                  next.revision >= item.revision
                )
                  updated(next);
              } catch (failure) {
                if (
                  alive.current &&
                  failure instanceof ApiClientError &&
                  [401, 403].includes(failure.status)
                )
                  invalidateAccountView();
              }
            }),
        );
      if (alive.current) timer = setTimeout(() => void poll(), 3000);
    }
    timer = setTimeout(() => void poll(), 3000);
    const invalidate = () => {
      alive.current = false;
      request.current?.abort();
      mutation.current?.abort();
      controller.abort();
      clearTimeout(timer);
      setInvalid(true);
      setList({ ...initial, videos: [] });
      setResume(null);
      commands.current.clear();
      creates.current.clear();
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      alive.current = false;
      request.current?.abort();
      mutation.current?.abort();
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [viewerId]);
  async function command(
    video: VideoAssetSnapshot,
    operation: "delete" | "retry",
  ) {
    if (mutation.current || !alive.current) return;
    const key = `${video.id}:${operation}`,
      existing = commands.current.get(key);
    if (
      operation === "delete" &&
      !existing &&
      !window.confirm(
        `Remove ${video.fileName}? Recordings used by saved scenarios or history cannot be removed.`,
      )
    )
      return;
    const input = existing ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: video.revision,
    };
    commands.current.set(key, input);
    const controller = new AbortController();
    mutation.current = controller;
    setRowPending(video.id);
    setError(null);
    try {
      const result =
        operation === "delete"
          ? await deleteCreatorVideo(video.id, input, controller.signal)
          : await retryVideoValidation(video.id, input, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      updated(result.video);
      if (operation !== "delete" || result.video.state === "deleted")
        commands.current.delete(key);
      if (result.video.state === "deleted" && resume?.id === video.id)
        setResume(null);
    } catch (failure) {
      if (!alive.current || controller.signal.aborted) return;
      if (failure instanceof ApiClientError && failure.status === 409) {
        commands.current.delete(key);
        try {
          updated(await getCreatorVideo(video.id, controller.signal));
        } catch {}
      }
      fail(failure);
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setRowPending(null);
      }
    }
  }
  async function createScenario(video: VideoAssetSnapshot) {
    if (mutation.current || !alive.current || video.state !== "ready") return;
    const operation = creates.current.get(video.id) ?? {
      requestId: crypto.randomUUID(),
    };
    creates.current.set(video.id, operation);
    const controller = new AbortController();
    mutation.current = controller;
    setRowPending(video.id);
    setError(null);
    try {
      if (!operation.save) {
        const result = await createCreatorScenario(
          { requestId: operation.requestId },
          controller.signal,
        );
        if (!alive.current || controller.signal.aborted) return;
        operation.scenarioId = result.scenario.id;
        // An existing replay may already have been edited in another tab. Open it without replacing that work.
        const content = result.scenario.draft.content;
        if (
          result.replayed &&
          (content.title ||
            content.question ||
            content.source.kind === "uploaded" ||
            (content.source.kind !== "uploaded" && content.source.url))
        ) {
          router.push(`/creator/scenarios/${result.scenario.id}`);
          creates.current.delete(video.id);
          return;
        }
        operation.save = {
          requestId: crypto.randomUUID(),
          expectedRevision: result.scenario.revision,
          content: {
            ...content,
            source: {
              ...createUploadedSource(video.id),
              title: video.fileName,
            },
          },
        };
      }
      await saveCreatorScenario(
        operation.scenarioId!,
        operation.save,
        controller.signal,
      );
      if (!alive.current || controller.signal.aborted) return;
      creates.current.delete(video.id);
      router.push(`/creator/scenarios/${operation.scenarioId}`);
    } catch (failure) {
      if (!controller.signal.aborted && alive.current) fail(failure);
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setRowPending(null);
      }
    }
  }
  if (invalid)
    return (
      <section className="status-panel">
        <h2>Your creator session changed.</h2>
        <Link href="/sign-in">Sign in again</Link>
      </section>
    );
  return (
    <div className="video-library">
      <VideoUpload
        viewerId={viewerId}
        onVideo={updated}
        resumeVideo={resume}
        onBusy={setUploadBusy}
      />
      <section
        className="creator-section"
        aria-label="Your uploaded recordings"
      >
        <div className="creator-save-actions">
          <h2>Your recordings</h2>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void loadMore()}
          >
            Refresh videos
          </button>
        </div>
        {!list.validator.online && (
          <p className="quiet-note">
            File validation is currently offline. Uploaded recordings wait here
            until the local validator is running.
          </p>
        )}
        {error && (
          <p className="creator-alert" role="alert">
            {error}
          </p>
        )}
        {!list.videos.some((item) => item.state !== "deleted") && (
          <p>
            No recordings yet. You can also keep authoring with YouTube links.
          </p>
        )}
        <ul className="video-list">
          {list.videos
            .filter((item) => item.state !== "deleted")
            .map((video) => (
              <li key={video.id} className="video-list-item">
                <div>
                  <h3>{video.fileName}</h3>
                  <p>
                    {stateLabels[video.state]} ·{" "}
                    {formatUploadLimit(video.actualByteSize ?? video.byteSize)}
                    {video.metadata
                      ? ` · ${formatTimestampInput(video.metadata.durationSeconds)} · ${video.metadata.width}×${video.metadata.height}`
                      : ""}
                  </p>
                  {video.metadata?.audioCodec === null && (
                    <p className="quiet-note">
                      Silent recording. Account for the missing audio in your
                      scenario.
                    </p>
                  )}
                  {video.failure && (
                    <p className="field-error">{video.failure.message}</p>
                  )}
                  {!video.canDelete && video.state === "ready" && (
                    <p className="quiet-note">
                      Used by a saved scenario or published version; retained
                      for learner history.
                    </p>
                  )}
                </div>
                <div className="creator-save-actions">
                  {video.state === "ready" && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={!!rowPending || uploadBusy}
                      onClick={() => void createScenario(video)}
                    >
                      Create scenario
                    </button>
                  )}
                  {video.state === "pending_upload" && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={uploadBusy}
                      onClick={() => {
                        setResume(video);
                        document.getElementById("creator-video-file")?.focus();
                      }}
                    >
                      Resume with original file
                    </button>
                  )}
                  {video.state === "rejected" && video.failure?.retryable && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!rowPending}
                      onClick={() => void command(video, "retry")}
                    >
                      Retry file check
                    </button>
                  )}
                  {(video.canDelete || video.state === "deleting") && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!rowPending || uploadBusy}
                      onClick={() => void command(video, "delete")}
                    >
                      {video.state === "deleting" ||
                      commands.current.has(`${video.id}:delete`)
                        ? "Retry removal"
                        : "Remove unused recording"}
                    </button>
                  )}
                </div>
              </li>
            ))}
        </ul>
        {list.nextCursor && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void loadMore(list.nextCursor)}
          >
            Load more videos
          </button>
        )}
      </section>
    </div>
  );
}
