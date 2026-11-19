"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CreatorFilter, CreatorListResponse } from "@/contracts/creator";
import {
  createCreatorScenario,
  listCreatorScenarios,
} from "@/lib/client/creator-api";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
import { CreatorStatus } from "./CreatorStatus";
export function CreatorDashboard({
  initial,
}: {
  initial: CreatorListResponse;
}) {
  const router = useRouter();
  const [list, setList] = useState(initial),
    [filter, setFilter] = useState<CreatorFilter>("all");
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
      setList({ scenarios: [], nextCursor: null });
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
      const result = await createCreatorScenario(
        { requestId: createId.current },
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        router.push(`/creator/scenarios/${result.scenario.id}`);
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
  async function load(status: CreatorFilter, cursor: string | null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const next = await listCreatorScenarios(
        cursor,
        status,
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        setList((previous) => ({
          scenarios: cursor
            ? [
                ...new Map(
                  [...previous.scenarios, ...next.scenarios].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ]
            : next.scenarios,
          nextCursor: next.nextCursor,
        }));
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authError(error))
        setError("Your scenarios couldn’t load. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  function changeFilter(status: CreatorFilter) {
    setFilter(status);
    setList({ scenarios: [], nextCursor: null });
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
          <h2>Turn a moment into perspective.</h2>
          <p>
            Build a draft, test every choice, then publish your reviewed
            scenario.
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
                : "New scenario →"}
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
        aria-label="Filter your scenarios"
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
                  all: "All scenarios",
                  unpublished: "Private drafts",
                  published: "Published",
                  withdrawn: "Withdrawn",
                }[status]
              }
            </button>
          ),
        )}
      </div>
      {pending && <p role="status">Loading scenarios…</p>}
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
      {!pending && !error && !list.scenarios.length && (
        <section className="surface-card creator-empty">
          <h2>
            {filter === "all"
              ? "Your first scenario starts with one moment."
              : "No scenarios in this view yet."}
          </h2>
          <p>
            Save a video moment privately, add your reasoning, and review it
            before learners see it.
          </p>
        </section>
      )}
      <div className="creator-list">
        {list.scenarios.map((scenario) => (
          <article className="surface-card creator-row" key={scenario.id}>
            <div>
              <CreatorStatus
                publication={scenario.publication}
                canReview={scenario.canReview}
                reviewed={scenario.reviewed}
              />
              <h2>
                <Link href={`/creator/scenarios/${scenario.id}`}>
                  {scenario.title || "Untitled scenario"}
                </Link>
              </h2>
              <p className="quiet-note">
                Saved {new Date(scenario.updatedAt).toLocaleDateString()} ·
                Draft {scenario.draftRevision}
              </p>
            </div>
            <div className="creator-row-actions">
              <Link
                className="button button-secondary"
                href={`/creator/scenarios/${scenario.id}`}
              >
                Edit draft
              </Link>
              <Link
                className="text-button"
                href={`/creator/scenarios/${scenario.id}/review`}
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
          Load more scenarios
        </button>
      )}
    </>
  );
}
