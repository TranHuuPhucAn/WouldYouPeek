"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { VideoAssetSnapshot } from "@/contracts/video";
import { listCreatorVideos } from "@/lib/client/video-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import type {
  CreatorDraftContent,
  CreatorSourceAttribution,
  ValidationIssue,
} from "@/contracts/creator";
import { PlayerNameField } from "./PlayerNameField";
import { SelectField, TextField } from "./EditorFields";
import { parseYouTubeSource } from "@/lib/creator/content";
export function SourceFields({
  source,
  onChange,
  issues,
  onReplace,
}: {
  source: CreatorDraftContent["source"];
  onChange: (source: CreatorDraftContent["source"]) => void;
  issues: ValidationIssue[];
  onReplace: (source: CreatorDraftContent["source"]) => boolean;
}) {
  const updateSourceField = <K extends keyof CreatorSourceAttribution>(
    key: K,
    value: (typeof source)[K],
  ) => onChange({ ...source, [key]: value });
  const uploaded = source.kind === "uploaded";
  const parsedSource = !uploaded ? parseYouTubeSource(source.url) : null;
  const acceptedUrl = useRef(!uploaded && parsedSource ? source.url : "");
  const [videos, setVideos] = useState<VideoAssetSnapshot[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const valid = useRef(true);
  useEffect(() => {
    if (!uploaded && parsedSource) acceptedUrl.current = source.url;
  }, [uploaded, parsedSource?.videoId, !uploaded ? source.url : ""]);
  async function loadVideos(nextCursor: string | null = null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setLoadError(null);
    try {
      const response = await listCreatorVideos(nextCursor, controller.signal);
      if (controller.signal.aborted || !valid.current) return;
      setVideos((old) =>
        nextCursor
          ? [
              ...new Map(
                [...old, ...response.videos].map((video) => [video.id, video]),
              ).values(),
            ]
          : response.videos,
      );
      setCursor(response.nextCursor);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        valid.current &&
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      ) {
        invalidateAccountView();
        return;
      }
      if (!controller.signal.aborted && valid.current)
        setLoadError(
          error instanceof Error
            ? error.message
            : "Your recordings could not load.",
        );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      setVideos([]);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    if (uploaded) void loadVideos();
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [uploaded]);
  function attribution(): CreatorSourceAttribution {
    const {
      title,
      uploader,
      player,
      map,
      agent,
      score,
      matchType,
      round,
      side,
      publishedDate,
      dateNote,
    } = source;
    return {
      title,
      uploader,
      player,
      map,
      agent,
      score,
      matchType,
      round,
      side,
      publishedDate,
      dateNote,
    };
  }
  function chooseKind(kind: string): boolean {
    if (kind === "uploaded" && !uploaded)
      return onReplace({
        ...attribution(),
        kind: "uploaded",
        assetId: null,
        creditUrl: "",
      });
    else if (kind === "youtube" && uploaded) {
      const accepted = onReplace({ ...attribution(), url: "" });
      if (accepted) acceptedUrl.current = "";
      return accepted;
    }
    return true;
  }
  function changeYouTubeUrl(url: string) {
    if (uploaded) return;
    const next = parseYouTubeSource(url),
      old = parseYouTubeSource(acceptedUrl.current);
    if (next && next.videoId !== old?.videoId) {
      if (onReplace({ ...source, url })) acceptedUrl.current = url;
      else onChange({ ...source, url: acceptedUrl.current });
    } else onChange({ ...source, url });
  }
  return (
    <fieldset className="creator-section">
      <legend>01 · Source and round</legend>
      <p>
        Use a player’s own information. Credit the recording and enter its
        context; metadata is not fetched automatically.
      </p>
      <SelectField
        path="source.kind"
        label="Video source"
        value={uploaded ? "uploaded" : "youtube"}
        onChange={chooseKind}
        choices={[
          { value: "youtube", label: "YouTube link" },
          { value: "uploaded", label: "Uploaded recording" },
        ]}
      />
      {uploaded ? (
        <>
          <SelectField
            path="source.assetId"
            label="Uploaded recording"
            value={source.assetId ?? ""}
            issues={issues}
            onChange={(id) => {
              const selected = videos.find(
                (v) => v.id === id && v.state === "ready",
              );
              if (!id || selected)
                return onReplace({ ...source, assetId: id || null });
              return false;
            }}
            choices={[
              { value: "", label: "Choose a ready recording" },
              ...(source.assetId &&
              !videos.some((video) => video.id === source.assetId)
                ? [{ value: source.assetId, label: "Current saved recording" }]
                : []),
              ...videos
                .filter((video) => video.state === "ready")
                .map((video) => ({ value: video.id, label: video.fileName })),
            ]}
          />
          <div className="creator-save-actions">
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => void loadVideos()}
            >
              Refresh recordings
            </button>
            {cursor && (
              <button
                type="button"
                className="text-button"
                disabled={pending}
                onClick={() => void loadVideos(cursor)}
              >
                Load more recordings
              </button>
            )}
            <Link href="/creator/videos" className="text-button">
              Upload or manage videos →
            </Link>
          </div>
          {pending && <p role="status">Loading your recordings…</p>}
          {loadError && (
            <p role="alert" className="field-error">
              {loadError}
            </p>
          )}
          <TextField
            path="source.creditUrl"
            label="Original source credit URL (optional)"
            value={source.creditUrl}
            onChange={(creditUrl) => onChange({ ...source, creditUrl })}
            maxLength={2048}
            issues={issues}
            hint="An optional original source link. Learners receive protected playback separately."
          />
        </>
      ) : (
        <>
          <TextField
            path="source.url"
            label="YouTube URL"
            value={source.url}
            onChange={changeYouTubeUrl}
            maxLength={2048}
            issues={issues}
            placeholder="https://www.youtube.com/watch?v=…"
            hint="YouTube watch or youtu.be link. Mark or enter timestamps below."
          />
          {source.url.trim() && (
            <p className="quiet-note" role="status">
              {parsedSource
                ? "Recognized YouTube link. Source credit remains yours to check."
                : "This link is not supported for publication. You can still save the draft and replace it later."}
            </p>
          )}
        </>
      )}
      <div className="creator-field-grid">
        <PlayerNameField
          value={source.player}
          onChange={(value) => updateSourceField("player", value)}
          issues={issues}
        />
        {(
          [
            ["title", "Source video title"],
            ["uploader", "Channel / uploader"],
            ["map", "Map"],
            ["agent", "Agent"],
            ["score", "Score before the round"],
          ] as const
        ).map(([key, label]) => (
          <TextField
            key={key}
            path={`source.${key}`}
            label={label}
            value={source[key]}
            onChange={(value) => updateSourceField(key, value)}
            maxLength={300}
            issues={issues}
            placeholder={key === "score" ? "5-5" : undefined}
          />
        ))}
        <SelectField
          path="source.matchType"
          label="Match type"
          value={source.matchType ?? ""}
          onChange={(value) =>
            updateSourceField(
              "matchType",
              (value as typeof source.matchType) || null,
            )
          }
          choices={[
            { value: "", label: "Choose match type" },
            { value: "ranked", label: "Ranked" },
            { value: "tournament", label: "Tournament" },
          ]}
          issues={issues}
        />
        <SelectField
          path="source.side"
          label="Player’s side"
          value={source.side ?? ""}
          onChange={(value) =>
            updateSourceField("side", (value as typeof source.side) || null)
          }
          choices={[
            { value: "", label: "Choose side" },
            { value: "attack", label: "Attack" },
            { value: "defense", label: "Defense" },
          ]}
          issues={issues}
        />
        <TextField
          path="source.round"
          label="Round number"
          value={source.round === null ? "" : String(source.round)}
          onChange={(value) =>
            updateSourceField("round", value === "" ? null : Number(value))
          }
          maxLength={3}
          type="number"
          issues={issues}
        />
        <TextField
          path="source.publishedDate"
          label="Source date (optional)"
          value={source.publishedDate}
          onChange={(value) => updateSourceField("publishedDate", value)}
          maxLength={10}
          type="date"
          issues={issues}
        />
        <TextField
          path="source.dateNote"
          label="Source date note (optional)"
          value={source.dateNote}
          onChange={(value) => updateSourceField("dateNote", value)}
          maxLength={300}
          issues={issues}
        />
      </div>
    </fieldset>
  );
}
