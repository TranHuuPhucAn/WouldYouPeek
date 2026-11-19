"use client";
import { useEffect, useRef, useState } from "react";
import type { CreatorDraftContent, ValidationIssue } from "@/contracts/creator";
import { useAuthoringVideo } from "@/hooks/use-authoring-video";
import {
  applyMarkedTime,
  applyTypedTime,
  applyTimingValues,
  createTimingState,
  timingFields,
  timingInputIssues,
  type TimingField,
  type TimingState,
} from "@/lib/creator/timing-state";
import { formatTimestampInput } from "@/lib/creator/timestamps";
import { TimingFields } from "./TimingFields";
import { validateSegment } from "@/lib/video/segment-controller";

export function VideoTimingEditor({
  source,
  media,
  onChange,
  issues,
  onInputIssues,
}: {
  source: CreatorDraftContent["source"];
  media: CreatorDraftContent["media"];
  onChange: (media: CreatorDraftContent["media"]) => void;
  issues: ValidationIssue[];
  onInputIssues: (issues: ValidationIssue[]) => void;
}) {
  const player = useAuthoringVideo(source);
  const [raw, setRaw] = useState(() => createTimingState(media));
  const last = useRef(media);
  const callbacks = useRef({ onInputIssues });
  callbacks.current = { onInputIssues };
  const [rehearsal, setRehearsal] = useState<"off" | "seeking" | "playing">(
    "off",
  );
  useEffect(() => {
    const changed = timingFields.filter(
      (field) => media[field] !== last.current[field],
    );
    last.current = media;
    if (changed.length)
      setRaw((state) => ({
        ...state,
        ...Object.fromEntries(
          changed.map((field) => [field, formatTimestampInput(media[field])]),
        ),
      }));
  }, [media.startSeconds, media.decisionSeconds, media.endSeconds]);
  useEffect(() => {
    callbacks.current.onInputIssues(
      timingInputIssues(
        raw,
        source.kind === "uploaded" ? player.duration : null,
      ),
    );
  }, [raw, player.duration, source.kind]);
  useEffect(() => {
    if (
      rehearsal === "seeking" &&
      player.ready &&
      !player.seeking &&
      media.startSeconds !== null &&
      Math.abs(player.time - media.startSeconds) < 0.4
    ) {
      setRehearsal("playing");
      void player.play();
    }
    if (
      rehearsal === "playing" &&
      media.endSeconds !== null &&
      player.time >= media.endSeconds - 0.3
    ) {
      setRehearsal("off");
      player.pause();
    }
  }, [
    rehearsal,
    player.time,
    player.ready,
    player.seeking,
    media.startSeconds,
    media.endSeconds,
  ]);
  function update(next: TimingState) {
    setRaw(next);
    onChange(applyTimingValues(next, media));
  }
  function markTime(field: TimingField) {
    if (!player.ready || player.seeking) return;
    player.pause();
    setRehearsal("off");
    update(applyMarkedTime(raw, field, player.readTime()));
  }
  const names = {
    startSeconds: "setup start",
    decisionSeconds: "decision pause",
    endSeconds: "continuation end",
  };
  const canRehearse =
    media.startSeconds !== null &&
    media.decisionSeconds !== null &&
    media.endSeconds !== null &&
    validateSegment({
      startSeconds: media.startSeconds,
      endSeconds: media.decisionSeconds,
    }) &&
    validateSegment({
      startSeconds: media.decisionSeconds,
      endSeconds: media.endSeconds,
    }) &&
    !timingInputIssues(raw, source.kind === "uploaded" ? player.duration : null)
      .length;
  return (
    <div className="video-timing-editor">
      {player.hasSource && (
        <section
          className="creator-section authoring-player"
          aria-label="Manual video timing"
        >
          <h2>Find your decision moment</h2>
          <p>
            Watch the full recording and choose each timestamp. Save before
            using the learner preview.
          </p>
          <div className="authoring-viewport">
            {player.uploaded ? (
              player.sourceUrl && (
                <video
                  ref={player.nativeElementRef}
                  src={player.sourceUrl}
                  playsInline
                  preload="metadata"
                  aria-label="Source recording for manual timing"
                  {...player.nativeHandlers}
                />
              )
            ) : (
              <div className="youtube-viewport" ref={player.youtubeHost} />
            )}
          </div>
          {player.error && (
            <div role="alert" className="creator-alert">
              <p>{player.error}</p>
              <button
                type="button"
                className="button button-secondary"
                onClick={player.retry}
              >
                Retry source player
              </button>
            </div>
          )}
          <div className="authoring-controls">
            <button
              type="button"
              className="button button-secondary"
              disabled={!player.ready || player.seeking}
              onClick={() => {
                setRehearsal("off");
                if (player.playing) player.pause();
                else void player.play();
              }}
            >
              {player.playing ? "Pause recording" : "Play recording"}
            </button>
            <output className="mono" aria-label="Recording position">
              {formatTimestampInput(player.time)} /{" "}
              {player.duration === null
                ? "—"
                : formatTimestampInput(player.duration)}
            </output>
            <label className="volume-control">
              Recording volume
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={player.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="video-seek-label">
            Seek recording
            <input
              type="range"
              min="0"
              max={player.duration ?? 1}
              step="0.1"
              value={Math.min(player.time, player.duration ?? 1)}
              disabled={!player.ready}
              onChange={(e) => {
                setRehearsal("off");
                player.pause();
                player.seek(Number(e.target.value));
              }}
            />
          </label>
          <div className="timing-step-controls">
            {[-1, -0.1, 0.1, 1].map((amount) => (
              <button
                type="button"
                className="text-button"
                key={amount}
                disabled={!player.ready || player.seeking}
                onClick={() => {
                  setRehearsal("off");
                  player.pause();
                  player.seek(player.readTime() + amount);
                }}
              >
                {amount < 0 ? "Back" : "Forward"} {Math.abs(amount)}s
              </button>
            ))}
          </div>
          <div className="timing-mark-controls">
            {timingFields.map((field) => (
              <div key={field}>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!player.ready || player.seeking}
                  onClick={() => markTime(field)}
                >
                  Set {names[field]}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={!player.ready || media[field] === null}
                  onClick={() => {
                    setRehearsal("off");
                    player.pause();
                    player.seek(media[field]!);
                  }}
                >
                  Jump to {names[field]}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-button"
            disabled={!player.ready || !canRehearse}
            onClick={() => {
              player.pause();
              player.seek(media.startSeconds!);
              setRehearsal("seeking");
            }}
          >
            Play marked range
          </button>
          <p className="quiet-note">
            Time-based seeking is approximate. Check the saved learner preview
            and listen at normal speed before publication.
          </p>
        </section>
      )}
      <TimingFields
        media={media}
        onChange={onChange}
        issues={issues}
        raw={raw}
        onTimeChange={(field, text) => {
          setRehearsal("off");
          update(applyTypedTime(raw, field, text));
        }}
      />
    </div>
  );
}
