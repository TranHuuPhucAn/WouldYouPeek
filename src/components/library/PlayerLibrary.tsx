"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PlayerListResponse } from "@/contracts/player";
import { listLibraryPlayers } from "@/lib/client/library-api";
import { PlayerSection } from "./PlayerSection";

export function PlayerLibrary({
  initial,
  query = "",
}: {
  initial: PlayerListResponse;
  query?: string;
}) {
  const [list, setList] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function loadMore() {
    if (request.current || !list.nextCursor) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(false);
    try {
      const next = await listLibraryPlayers(
        { query, cursor: list.nextCursor },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setList((previous) => ({
          players: [
            ...new Map(
              [...previous.players, ...next.players].map((group) => [
                group.player.id,
                group,
              ]),
            ).values(),
          ],
          nextCursor: next.nextCursor,
        }));
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }
  return (
    <div className="player-library">
      <form action="/library" className="library-search" role="search">
        <label htmlFor="player-search">Search players</label>
        <div>
          <input
            id="player-search"
            type="search"
            name="query"
            defaultValue={query}
            maxLength={200}
            placeholder="Search player names"
          />
          <button className="button button-secondary" type="submit">
            Search
          </button>
          {query && (
            <Link className="text-button" href="/library">
              Clear search
            </Link>
          )}
        </div>
      </form>
      <h2 className="library-filter-heading">
        {query ? `Players matching “${query}”` : "All players"}
      </h2>
      {!list.players.length && (
        <section className="surface-card creator-empty">
          <h3>{query ? "No players found." : "No scenarios available yet."}</h3>
          <p>
            {query
              ? "Try another player name or browse all players."
              : "Published scenarios will appear here when they are ready."}
          </p>
          {query && (
            <Link className="text-button" href="/library">
              Browse all players →
            </Link>
          )}
        </section>
      )}
      {list.players.map((group) => (
        <PlayerSection key={group.player.id} group={group} />
      ))}
      {error && (
        <p className="field-error" role="alert">
          More players couldn’t load. Your current results are still here.
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
              ? "Retry loading players"
              : "Load more players"}
        </button>
      )}
    </div>
  );
}
