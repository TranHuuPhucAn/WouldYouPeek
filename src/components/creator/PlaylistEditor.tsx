"use client";
import { useState } from "react";
import Link from "next/link";
import type {
  CreatorPlaylistItem,
  CreatorPlaylistScenarioList,
  CreatorPlaylistSnapshot,
  PlaylistItemPreview,
} from "@/contracts/playlist";
import type { CreatorProfile } from "@/contracts/creator-profile";
import { usePlaylistEditor } from "@/hooks/use-playlist-editor";
import { validatePlaylistDraft } from "@/lib/playlists/content";
import {
  addPlaylistItem,
  movePlaylistItem,
  removePlaylistItem,
} from "@/lib/playlists/ordering";
import { PlaylistScenarioPicker } from "./PlaylistScenarioPicker";
import { PlaylistOrderEditor } from "./PlaylistOrderEditor";
import { PlaylistStatus } from "./PlaylistStatus";
export function PlaylistEditor({
  initial,
  initialCandidates,
  profile,
  viewerId,
}: {
  initial: CreatorPlaylistSnapshot;
  initialCandidates: CreatorPlaylistScenarioList;
  profile: CreatorProfile;
  viewerId: string;
}) {
  const editor = usePlaylistEditor(initial, viewerId),
    { state } = editor;
  const [previews, setPreviews] = useState(
    () =>
      new Map(
        initialCandidates.scenarios.map((item) => [
          `${item.scenarioId}:${item.scenarioVersion}`,
          item,
        ]),
      ),
  );
  if (state.invalid)
    return (
      <p role="status">Your creator session changed. Refreshing access…</p>
    );
  const content = state.content,
    issues = validatePlaylistDraft(content),
    locked = !!state.command || state.conflict;
  const rows: CreatorPlaylistItem[] = content.items.map(
    (selection, position) => {
      const saved = state.snapshot.items.find(
        (item) => item.selection.scenarioId === selection.scenarioId,
      );
      return {
        position,
        selection,
        preview:
          saved?.selection.scenarioVersion === selection.scenarioVersion
            ? saved.preview
            : (previews.get(
                `${selection.scenarioId}:${selection.scenarioVersion}`,
              ) ?? null),
        currentVersion:
          saved?.currentVersion ??
          previews.get(`${selection.scenarioId}:${selection.scenarioVersion}`)
            ?.scenarioVersion ??
          null,
        issues:
          saved?.selection.scenarioVersion === selection.scenarioVersion
            ? saved.issues
            : [],
      };
    },
  );
  function add(item: PlaylistItemPreview) {
    setPreviews((previous) =>
      new Map(previous).set(`${item.scenarioId}:${item.scenarioVersion}`, item),
    );
    editor.update({ ...content, items: addPlaylistItem(content.items, item) });
  }
  return (
    <div className="playlist-editor">
      <Link className="text-button" href="/creator/playlists">
        ← Your playlists
      </Link>
      <div className="page-heading">
        <span className="eyebrow">BUILD A TRAINING SEQUENCE</span>
        <h1>{state.snapshot.draft.content.title || "Untitled playlist"}</h1>
        <PlaylistStatus
          publication={state.snapshot.publication}
          canReview={state.snapshot.readiness.canReview}
          reviewed={!!state.snapshot.review}
        />
      </div>
      <section className="surface-card playlist-details">
        <label htmlFor="playlist-title">
          Playlist title
          <input
            id="playlist-title"
            value={content.title}
            maxLength={240}
            onChange={(event) =>
              editor.update({ ...content, title: event.target.value })
            }
          />
        </label>
        <label htmlFor="playlist-description">
          Description <span className="quiet-note">(optional)</span>
          <textarea
            id="playlist-description"
            value={content.description}
            maxLength={2000}
            rows={3}
            onChange={(event) =>
              editor.update({ ...content, description: event.target.value })
            }
          />
        </label>
        <p className="quiet-note">
          Public credit: {profile.displayName ?? "Not set"}.{" "}
          <Link href="/account">
            {profile.displayName
              ? "Manage public name"
              : "Set your public name before review"}
          </Link>
          .
        </p>
      </section>
      {issues.length > 0 && (
        <ul className="field-error" role="alert">
          {issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
      <div className="playlist-workspace">
        <PlaylistOrderEditor
          items={rows}
          disabled={locked}
          onMove={(id, direction) =>
            editor.update({
              ...content,
              items: movePlaylistItem(content.items, id, direction),
            })
          }
          onRemove={(id) =>
            editor.update({
              ...content,
              items: removePlaylistItem(content.items, id),
            })
          }
          onUpdate={(id, version) =>
            editor.update({
              ...content,
              items: content.items.map((item) =>
                item.scenarioId === id
                  ? { ...item, scenarioVersion: version }
                  : item,
              ),
            })
          }
        />
        <PlaylistScenarioPicker
          initial={initialCandidates}
          selected={content.items}
          onAdd={add}
          disabled={locked}
        />
      </div>
      <section className="surface-card playlist-save">
        <p role="status">
          {state.pending
            ? "Saving draft…"
            : state.command
              ? "Save confirmation pending."
              : editor.dirty
                ? "Unsaved changes. Save before leaving or reviewing."
                : "All changes saved."}
        </p>
        {state.error && (
          <p role="alert" className="field-error">
            {state.error}
          </p>
        )}
        <div className="creator-save-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={state.pending || state.conflict || issues.length > 0}
            onClick={() => void editor.saveDraft()}
          >
            {state.command ? "Retry the same save" : "Save draft"}
          </button>
          {!editor.dirty &&
            !state.pending &&
            !state.command &&
            !state.conflict && (
              <Link
                className="button button-secondary"
                href={`/creator/playlists/${initial.id}/review`}
              >
                Review saved playlist →
              </Link>
            )}
          {state.conflict && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void editor.fetchLatest()}
            >
              Compare latest saved draft
            </button>
          )}
        </div>
        {state.latest && (
          <div className="creator-alert">
            <h2>Latest saved draft</h2>
            <p>
              {state.latest.draft.content.title || "Untitled playlist"} ·{" "}
              {state.latest.draft.content.items.length} scenarios
            </p>
            <ol>
              {state.latest.items.map((item) => (
                <li key={item.selection.scenarioId}>
                  {item.preview?.title ?? item.selection.scenarioId} ·{" "}
                  {item.selection.scenarioVersion}
                </li>
              ))}
            </ol>
            <p>
              Your local edits remain above. Loading this draft replaces them.
            </p>
            <button
              type="button"
              className="button button-secondary"
              disabled={state.pending || !!state.command}
              onClick={editor.acceptLatest}
            >
              Replace my edits with this saved draft
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
