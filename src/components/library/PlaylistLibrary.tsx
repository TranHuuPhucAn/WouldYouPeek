"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LibraryPlaylistResponse } from "@/contracts/playlist";
import { listLibraryPlaylists } from "@/lib/client/playlist-api";
import { PlaylistCard } from "./PlaylistCard";
export function PlaylistLibrary({
  initial,
  query = "",
  playerId,
}: {
  initial: LibraryPlaylistResponse;
  query?: string;
  playerId?: string;
}) {
  const [list, setList] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function loadMore() {
    if (request.current || !list.nextCursor) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(false);
    try {
      const next = await listLibraryPlaylists(
        { query, playerId, cursor: list.nextCursor },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setList((previous) => ({
          playlists: [
            ...new Map(
              [...previous.playlists, ...next.playlists].map((item) => [
                item.id,
                item,
              ]),
            ).values(),
          ],
          nextCursor: next.nextCursor,
        }));
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setPending(false);
      }
    }
  }
  return (
    <div className="playlist-library">
      {!playerId && (
        <form
          action="/library/playlists"
          className="library-search"
          role="search"
        >
          <label htmlFor="playlist-player-search">
            Search included players
          </label>
          <div>
            <input
              id="playlist-player-search"
              type="search"
              name="query"
              defaultValue={query}
              maxLength={200}
              placeholder="Search player names"
            />
            <button className="button button-secondary">Search</button>
            {query && (
              <Link className="text-button" href="/library/playlists">
                Clear search
              </Link>
            )}
          </div>
        </form>
      )}
      <p className="quiet-note">
        Every playlist plays its full sequence, including all featured players.
      </p>
      {!list.playlists.length && (
        <section className="surface-card creator-empty">
          <h2>
            {query ? "No matching playlists." : "No playlists available yet."}
          </h2>
          <p>
            {query
              ? "Try another player name or clear your search."
              : "Published collections featuring this selection will appear here."}
          </p>
        </section>
      )}
      <div className="playlist-grid">
        {list.playlists.map((playlist) => (
          <PlaylistCard key={playlist.id} playlist={playlist} />
        ))}
      </div>
      {error && (
        <p role="alert" className="field-error">
          More playlists couldn’t load. Your current results are still here.
        </p>
      )}
      {list.nextCursor && (
        <button
          className="button button-secondary"
          disabled={pending}
          onClick={() => void loadMore()}
        >
          {pending
            ? "Loading…"
            : error
              ? "Retry loading playlists"
              : "Load more playlists"}
        </button>
      )}
    </div>
  );
}
