"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  PlaylistFilter,
  CreatorPlaylistListResponse,
} from "@/contracts/playlist";
import {
  createCreatorPlaylist,
  listCreatorPlaylists,
} from "@/lib/client/creator-playlist-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { PlaylistStatus } from "./PlaylistStatus";
export function PlaylistDashboard({
  initial,
}: {
  initial: CreatorPlaylistListResponse;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial),
    [filter, setFilter] = useState<PlaylistFilter>("all");
  const [pending, setPending] = useState(false),
    [creating, setCreating] = useState(false),
    [invalid, setInvalid] = useState(false),
    [error, setError] = useState<string | null>(null),
    [createError, setCreateError] = useState(false);
  const request = useRef<AbortController | null>(null),
    createRequest = useRef<AbortController | null>(null),
    createId = useRef<string | null>(null),
    valid = useRef(true);
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      createRequest.current?.abort();
      setInvalid(true);
      setList({ playlists: [], nextCursor: null });
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      createRequest.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, []);
  function authError(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  async function createDraft() {
    if (createRequest.current || !valid.current) return;
    const controller = new AbortController();
    createRequest.current = controller;
    createId.current ??= crypto.randomUUID();
    setCreating(true);
    setCreateError(false);
    try {
      const result = await createCreatorPlaylist(
        { requestId: createId.current },
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        router.push(`/creator/playlists/${result.playlist.id}`);
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authError(error))
        setCreateError(true);
    } finally {
      if (createRequest.current === controller) {
        createRequest.current = null;
        setCreating(false);
      }
    }
  }
  async function load(status: PlaylistFilter, cursor: string | null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await listCreatorPlaylists(
        cursor,
        status,
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        setList((previous) => ({
          playlists: cursor
            ? [
                ...new Map(
                  [...previous.playlists, ...next.playlists].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ]
            : next.playlists,
          nextCursor: next.nextCursor,
        }));
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authError(error))
        setError("Your playlists couldn’t load. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  function changeFilter(status: PlaylistFilter) {
    setFilter(status);
    setList({ playlists: [], nextCursor: null });
    void load(status, null);
  }
  if (invalid)
    return (
      <p role="status">Your sign-in changed. Refreshing creator access…</p>
    );
  return (
    <>
      <div className="creator-dashboard-intro">
        <div>
          <span className="eyebrow">YOUR EDITORIAL DESK</span>
          <h2>Build a sequence of decisions.</h2>
          <p>
            Choose your published scenarios, arrange their order, then review
            and publish a collection.
          </p>
        </div>
        <div className="creator-save-actions">
          <Link href="/creator/videos" className="button button-secondary">
            Your videos
          </Link>
          <button
            className="button button-primary"
            disabled={creating}
            onClick={() => void createDraft()}
          >
            {creating
              ? "Creating…"
              : createError
                ? "Retry creating draft"
                : "New playlist →"}
          </button>
        </div>
      </div>
      {createError && (
        <p role="alert" className="field-error">
          We couldn’t confirm draft creation. Retry to recover the same draft.
        </p>
      )}
      <div
        className="creator-filter"
        role="group"
        aria-label="Filter your playlists"
      >
        {(["all", "unpublished", "published", "withdrawn"] as const).map(
          (status) => (
            <button
              key={status}
              aria-pressed={status === filter}
              onClick={() => changeFilter(status)}
            >
              {
                {
                  all: "All playlists",
                  unpublished: "Private drafts",
                  published: "Published",
                  withdrawn: "Withdrawn",
                }[status]
              }
            </button>
          ),
        )}
      </div>
      {pending && <p role="status">Loading playlists…</p>}
      {error && (
        <div role="alert" className="creator-alert">
          <p>{error}</p>
          <button
            className="text-button"
            onClick={() => void load(filter, list.nextCursor)}
          >
            Retry loading
          </button>
        </div>
      )}
      {!pending && !error && !list.playlists.length && (
        <section className="surface-card creator-empty">
          <h2>
            {filter === "all"
              ? "Your first playlist starts with one moment."
              : "No playlists in this view yet."}
          </h2>
          <p>
            Save a video moment privately, add your reasoning, and review it
            before learners see it.
          </p>
        </section>
      )}
      <div className="creator-list">
        {list.playlists.map((playlist) => (
          <article className="surface-card creator-row" key={playlist.id}>
            <div>
              <PlaylistStatus
                publication={playlist.publication}
                canReview={playlist.canReview}
                reviewed={playlist.reviewed}
              />
              <h2>
                <Link href={`/creator/playlists/${playlist.id}`}>
                  {playlist.title || "Untitled playlist"}
                </Link>
              </h2>
              <p className="quiet-note">
                Saved {new Date(playlist.updatedAt).toLocaleDateString()} ·
                Draft {playlist.draftRevision}
              </p>
            </div>
            <div className="creator-row-actions">
              <Link
                className="button button-secondary"
                href={`/creator/playlists/${playlist.id}`}
              >
                Edit draft
              </Link>
              <Link
                className="text-button"
                href={`/creator/playlists/${playlist.id}/review`}
              >
                Review →
              </Link>
            </div>
          </article>
        ))}
      </div>
      {list.nextCursor && (
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => void load(filter, list.nextCursor)}
        >
          Load more playlists
        </button>
      )}
    </>
  );
}
