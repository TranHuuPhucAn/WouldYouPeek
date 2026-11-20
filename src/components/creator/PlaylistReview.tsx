"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  PlaylistCommand,
  PlaylistReviewPreview,
  CreatorPlaylistSnapshot,
  PublishPlaylistRequest,
  PlaylistReviewChecklist,
  ReviewPlaylistRequest,
} from "@/contracts/playlist";
import { PLAYLIST_REVIEW_CHECKLIST_KEYS } from "@/contracts/playlist";
import {
  getCreatorPlaylistReview,
  getCreatorPlaylist,
  publishCreatorPlaylist,
  reviewCreatorPlaylist,
  unpublishCreatorPlaylist,
} from "@/lib/client/creator-playlist-api";
import { validatePlaylistContinuity } from "@/lib/client/playlist-validation";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { PlaylistItemList } from "./PlaylistItemList";
import { PlaylistStatus } from "./PlaylistStatus";
const labels: Record<keyof PlaylistReviewChecklist, string> = {
  orderChecked: "I checked the title, description and scenario order.",
  selectedVersionsChecked:
    "I checked the selected scenario versions and their availability.",
  mixedPlayersChecked:
    "I checked all included players and the complete sequence.",
  creditChecked: "I checked the public creator credit shown above.",
};
const emptyChecklist = () =>
  Object.fromEntries(
    PLAYLIST_REVIEW_CHECKLIST_KEYS.map((key) => [key, false]),
  ) as PlaylistReviewChecklist;
type Command =
  | { kind: "review"; input: ReviewPlaylistRequest }
  | { kind: "publish"; input: PublishPlaylistRequest }
  | { kind: "unpublish"; input: PlaylistCommand };
export function PlaylistReview({
  initial,
  initialPreview,
  initialError,
  viewerId,
}: {
  initial: CreatorPlaylistSnapshot;
  initialPreview: PlaylistReviewPreview | null;
  initialError?: string;
  viewerId: string;
}) {
  const [playlist, setPlaylist] = useState(initial),
    [preview, setPreview] = useState(initialPreview),
    [checklist, setChecklist] = useState<PlaylistReviewChecklist>(
      initial.review?.checklist ?? emptyChecklist,
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(initialError ?? null),
    [unresolved, setUnresolved] = useState(false),
    [conflict, setConflict] = useState(!!initialError),
    [invalid, setInvalid] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null),
    command = useRef<Command | null>(null),
    valid = useRef(true),
    current = useRef(playlist),
    owner = useRef(viewerId);
  current.current = playlist;
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      command.current = null;
      setPreview(null);
      setInvalid(true);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, []);
  useEffect(() => {
    if (owner.current !== viewerId) {
      valid.current = false;
      request.current?.abort();
      setInvalid(true);
      setPreview(null);
    }
  }, [viewerId]);
  function authFailure(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  async function execute(next: Command) {
    if (request.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    command.current = next;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        next.kind === "review"
          ? await reviewCreatorPlaylist(
              initial.id,
              next.input,
              controller.signal,
            )
          : next.kind === "publish"
            ? await publishCreatorPlaylist(
                initial.id,
                next.input,
                controller.signal,
              )
            : await unpublishCreatorPlaylist(
                initial.id,
                next.input,
                controller.signal,
              );
      if (controller.signal.aborted || !valid.current) return;
      validatePlaylistContinuity(result.playlist, current.current);
      const contentChanged =
        result.playlist.draft.revision !== current.current.draft.revision;
      setPlaylist(result.playlist);
      if (contentChanged) {
        setPreview(null);
        setChecklist(emptyChecklist());
        setConflict(true);
        setNotice(
          "The draft changed after this command. Reload the latest saved preview before continuing.",
        );
      } else {
        // Review/publication changes the owner revision, while this preview's draft stays identical.
        setPreview((saved) =>
          saved ? { ...saved, playlist: result.playlist } : null,
        );
        setChecklist(result.playlist.review?.checklist ?? emptyChecklist());
        setConflict(false);
        setNotice(
          next.kind === "review"
            ? "Saved revision reviewed. You can publish it now."
            : next.kind === "publish"
              ? "Playlist published. Learners can now open it in Library."
              : "Playlist withdrawn. Existing learner sessions keep their saved content.",
        );
      }
      command.current = null;
      setUnresolved(false);
    } catch (error) {
      if (controller.signal.aborted || !valid.current || authFailure(error))
        return;
      const rejected =
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500;
      const stale = error instanceof ApiClientError && error.status === 409;
      if (rejected) command.current = null;
      setUnresolved(!rejected);
      setConflict(stale);
      setError(
        stale
          ? "This saved revision or review has changed. Reload and review the latest draft."
          : rejected
            ? error.message
            : "We couldn’t confirm this action. Retry the same action to safely recover its result.",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  async function reloadReview() {
    if (request.current || !valid.current || command.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const latest = await getCreatorPlaylist(initial.id, controller.signal);
      validatePlaylistContinuity(latest, current.current);
      const nextPreview = latest.readiness.canReview
        ? await getCreatorPlaylistReview(
            initial.id,
            latest.revision,
            controller.signal,
          )
        : null;
      if (controller.signal.aborted || !valid.current) return;
      setPlaylist(latest);
      setPreview(nextPreview);
      setChecklist(latest.review?.checklist ?? emptyChecklist());
      setConflict(false);
      setNotice(null);
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authFailure(error))
        setError("The latest review couldn’t load. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  const base = () => ({
    requestId: crypto.randomUUID(),
    expectedRevision: playlist.revision,
  });
  const canReview = playlist.readiness.canReview && !!preview && !conflict;
  if (invalid)
    return (
      <p role="status">Your creator session has changed. Refreshing access…</p>
    );
  return (
    <div className="creator-review">
      <Link href={`/creator/playlists/${initial.id}`} className="text-button">
        ← Edit playlist draft
      </Link>
      <div className="page-heading">
        <span className="eyebrow">REVIEW THE SAVED COLLECTION</span>
        <h1>{playlist.draft.content.title || "Untitled playlist"}</h1>
        <p className="playlist-description">
          {playlist.draft.content.description}
        </p>
        <p>
          Draft {playlist.draft.revision} ·{" "}
          {playlist.draft.content.items.length} scenarios. This is your own
          editorial review.
        </p>
        <PlaylistStatus
          publication={playlist.publication}
          reviewed={!!playlist.review}
          canReview={playlist.readiness.canReview}
        />
      </div>
      {error && (
        <div className="creator-alert" role="alert">
          <p>{error}</p>
          {unresolved ? (
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => command.current && void execute(command.current)}
            >
              Retry the same action
            </button>
          ) : (
            <button
              className="button button-secondary"
              disabled={pending}
              onClick={() => void reloadReview()}
            >
              Reload latest review
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="creator-notice">
          {notice}
        </p>
      )}
      {conflict && !error && (
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => void reloadReview()}
        >
          Reload latest review
        </button>
      )}
      {!playlist.readiness.canReview && (
        <section className="creator-issues">
          <h2>Resolve these items before review</h2>
          <ul>
            {playlist.readiness.issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
          <Link href="/account">Manage public creator name</Link>
        </section>
      )}
      {playlist.publication.issues.length > 0 && (
        <section className="creator-issues">
          <h2>Publication needs attention</h2>
          <ul>
            {playlist.publication.issues.map((issue, index) => (
              <li key={index}>{issue.message}</li>
            ))}
          </ul>
          <p>
            Restore or remove the affected scenarios, then review and publish a
            new playlist version. Existing learner sessions remain available.
          </p>
        </section>
      )}
      {preview && (
        <section aria-label="Saved playlist preview">
          <p>
            Public credit: <strong>{preview.credit.displayName}</strong>
          </p>
          <PlaylistItemList items={preview.items} ownerReview />
        </section>
      )}
      <section className="surface-card review-checklist">
        <h2>Review this collection</h2>
        <p>
          Confirm the saved sequence and credit. Individual scenario reviews
          remain attached to their selected versions.
        </p>
        <fieldset
          disabled={pending || unresolved || !canReview || !!playlist.review}
        >
          <legend className="sr-only">Confirm your playlist review</legend>
          {PLAYLIST_REVIEW_CHECKLIST_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={checklist[key]}
                onChange={(event) =>
                  setChecklist({ ...checklist, [key]: event.target.checked })
                }
              />
              <span>{labels[key]}</span>
            </label>
          ))}
        </fieldset>
        <button
          className="button button-primary"
          disabled={
            pending ||
            unresolved ||
            !canReview ||
            !PLAYLIST_REVIEW_CHECKLIST_KEYS.every((key) => checklist[key]) ||
            !!playlist.review
          }
          onClick={() => {
            if (preview)
              void execute({
                kind: "review",
                input: {
                  ...base(),
                  profileRevision: preview.profileRevision,
                  checklist: { ...checklist },
                },
              });
          }}
        >
          {pending
            ? "Saving…"
            : playlist.review
              ? "This revision is reviewed"
              : "Mark reviewed"}
        </button>
      </section>
      <section className="surface-card publication-controls">
        <h2>Publish your playlist</h2>
        <p>
          Publishing makes this exact reviewed collection available in Library.
          Later edits stay private until you publish again.
        </p>
        <div className="creator-save-actions">
          <button
            className="button button-primary"
            disabled={pending || unresolved || conflict || !playlist.review}
            onClick={() => {
              if (playlist.review)
                void execute({
                  kind: "publish",
                  input: { ...base(), reviewId: playlist.review.id },
                });
            }}
          >
            Publish playlist
          </button>
          {playlist.publication.state === "published" && (
            <button
              className="button button-secondary"
              disabled={pending || unresolved || conflict}
              onClick={() => void execute({ kind: "unpublish", input: base() })}
            >
              Unpublish playlist
            </button>
          )}
          {playlist.publication.state === "published" &&
            playlist.publication.availability === "available" && (
              <Link
                className="text-button"
                href={`/library/playlists/${playlist.id}`}
              >
                View published playlist →
              </Link>
            )}
        </div>
        <p className="quiet-note">
          Unpublishing stops new sessions; saved sessions keep their content.
        </p>
      </section>
    </div>
  );
}
