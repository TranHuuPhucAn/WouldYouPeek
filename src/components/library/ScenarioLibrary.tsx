"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LibraryListResponse } from "@/contracts/library";
import { listLibraryScenarios } from "@/lib/client/library-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function ScenarioLibrary({ initial }: { initial: LibraryListResponse }) {
  const [list, setList] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState(false),
    [invalid, setInvalid] = useState(false);
  const request = useRef<AbortController | null>(null),
    valid = useRef(true);
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      setInvalid(true);
      setList({ scenarios: [], nextCursor: null });
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
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
        list.nextCursor,
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
    } catch (error) {
      if (!controller.signal.aborted && valid.current) {
        if (
          error instanceof ApiClientError &&
          [401, 403].includes(error.status)
        )
          invalidateAccountView();
        else setError(true);
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  if (invalid)
    return <p role="status">Your sign-in changed. Refreshing the library…</p>;
  return (
    <>
      {!list.scenarios.length && (
        <section className="surface-card creator-empty">
          <h2>The library is waiting for its first scenario.</h2>
          <p>
            Published creator scenarios will appear here. The original three
            moments are ready to play.
          </p>
          <Link href="/play" className="button button-primary">
            Open demo practice →
          </Link>
          <Link href="/creator" className="text-button">
            Explore creator access
          </Link>
        </section>
      )}
      <div className="library-grid">
        {list.scenarios.map((item) => (
          <article className="library-card" key={item.id}>
            <span className="eyebrow">{item.topic}</span>
            <h2>
              <Link href={`/library/${item.id}`}>{item.title}</Link>
            </h2>
            <p>
              {item.source?.player} · {item.source?.agent} · {item.source?.map}
            </p>
            <p className="library-context">{item.context}</p>
            <div className="library-card-footer">
              <span>
                {item.provenance === "ai-assisted"
                  ? "Creator-reviewed · AI-assisted"
                  : "Creator-reviewed"}
              </span>
              <Link className="text-button" href={`/library/${item.id}`}>
                Explore scenario →
              </Link>
            </div>
          </article>
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
