"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  CreatorPlaylistScenarioList,
  PlaylistItemPreview,
  PlaylistSelection,
} from "@/contracts/playlist";
import { listPlaylistScenarioCandidates } from "@/lib/client/creator-playlist-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function PlaylistScenarioPicker({
  initial,
  selected,
  onAdd,
  disabled = false,
}: {
  initial: CreatorPlaylistScenarioList;
  selected: PlaylistSelection[];
  onAdd: (item: PlaylistItemPreview) => void;
  disabled?: boolean;
}) {
  const [list, setList] = useState(initial),
    [query, setQuery] = useState(""),
    [applied, setApplied] = useState(""),
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
      setList({ scenarios: [], nextCursor: null });
      setInvalid(true);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, []);
  async function load(search: string, cursor: string | null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(false);
    try {
      const next = await listPlaylistScenarioCandidates(
        search,
        cursor,
        controller.signal,
      );
      if (valid.current && !controller.signal.aborted)
        setList((previous) => ({
          scenarios: cursor
            ? [
                ...new Map(
                  [...previous.scenarios, ...next.scenarios].map((item) => [
                    item.scenarioId,
                    item,
                  ]),
                ).values(),
              ]
            : next.scenarios,
          nextCursor: next.nextCursor,
        }));
    } catch (error) {
      if (valid.current && !controller.signal.aborted) {
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
        if (valid.current && !controller.signal.aborted) setPending(false);
      }
    }
  }
  if (invalid)
    return <p role="status">Your creator access changed. Refreshing…</p>;
  return (
    <section className="surface-card playlist-picker">
      <h2>Add published scenarios</h2>
      <p className="quiet-note">
        Choose from your published scenarios. Each selection keeps the version
        shown.
      </p>
      <form
        className="library-search"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(query.trim());
          setList({ scenarios: [], nextCursor: null });
          void load(query.trim(), null);
        }}
      >
        <label htmlFor="playlist-scenario-search">
          Search your published scenarios
        </label>
        <div>
          <input
            id="playlist-scenario-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
          />
          <button className="button button-secondary" disabled={disabled}>
            Search
          </button>
        </div>
      </form>
      {pending && <p role="status">Loading published scenarios…</p>}
      {!list.scenarios.length && !pending && !error && (
        <p>
          No published scenarios match.{" "}
          <Link href="/creator">Manage your scenarios</Link>.
        </p>
      )}
      {selected.length === 20 && (
        <p role="status">
          This playlist has 20 scenarios. Remove one to add another.
        </p>
      )}
      <ul className="playlist-candidates">
        {list.scenarios.map((item) => {
          const added = selected.some(
            (selection) => selection.scenarioId === item.scenarioId,
          );
          return (
            <li key={item.scenarioId}>
              <div>
                <h3>{item.title}</h3>
                <p>
                  {item.player.displayName} · {item.map} · {item.topic} ·{" "}
                  {item.sourceKind === "youtube"
                    ? "YouTube"
                    : "Uploaded recording"}
                </p>
                <small className="quiet-note">
                  Published version {item.scenarioVersion}
                </small>
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={disabled || added || selected.length >= 20}
                onClick={() => onAdd(item)}
                aria-label={`${added ? "Added" : "Add"} ${item.title}`}
              >
                {added ? "Added" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="field-error" role="alert">
          Published scenarios couldn’t load.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void load(applied, list.nextCursor)}
          >
            Retry
          </button>
        </p>
      )}
      {list.nextCursor && (
        <button
          type="button"
          className="button button-secondary"
          disabled={pending || disabled}
          onClick={() => void load(applied, list.nextCursor)}
        >
          Load more published scenarios
        </button>
      )}
    </section>
  );
}
