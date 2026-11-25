"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LibraryListResponse } from "@/contracts/library";
import { listLibraryScenarios } from "@/lib/client/library-api";
import { ScenarioCard } from "./ScenarioCard";
export function ScenarioLibrary({
  initial,
  playerId,
}: {
  initial: LibraryListResponse;
  playerId?: string;
}) {
  const [list, setList] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null),
    valid = useRef(true);
  useEffect(() => {
    valid.current = true;
    return () => {
      valid.current = false;
      request.current?.abort();
    };
  }, []);
  async function loadMore() {
    if (request.current || !list.nextCursor || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(false);
    try {
      const next = await listLibraryScenarios(
        { cursor: list.nextCursor, playerId },
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        setList((previous) => ({
          scenarios: [
            ...new Map(
              [...previous.scenarios, ...next.scenarios].map((item) => [
                item.id,
                item,
              ]),
            ).values(),
          ],
          nextCursor: next.nextCursor,
        }));
    } catch {
      if (!controller.signal.aborted && valid.current) {
        setError(true);
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  return (
    <>
      {!list.scenarios.length && (
        <section className="surface-card creator-empty">
          <h2>No published scenarios for this player yet.</h2>
          <p>Browse the other players while this collection grows.</p>
          <Link href="/library" className="text-button">
            Browse all players →
          </Link>
        </section>
      )}
      <div className="library-grid">
        {list.scenarios.map((item) => (
          <ScenarioCard key={item.id} scenario={item} />
        ))}
      </div>
      {error && (
        <p role="alert" className="field-error">
          More scenarios couldn’t load. Try again.
        </p>
      )}
      {list.nextCursor && (
        <button
          className="button button-secondary"
          onClick={() => void loadMore()}
          disabled={pending}
        >
          {pending
            ? "Loading…"
            : error
              ? "Retry loading scenarios"
              : "Load more scenarios"}
        </button>
      )}
    </>
  );
}
