"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CreatorProfile,
  SaveCreatorProfileRequest,
} from "@/contracts/creator-profile";
import {
  getCreatorProfile,
  saveCreatorProfile,
} from "@/lib/client/creator-profile-api";
import {
  normalizeCreatorDisplayName,
  validateCreatorDisplayName,
} from "@/lib/playlists/content";
import { ApiClientError } from "@/lib/client/api-response";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";
export function CreatorProfileForm({
  initial,
  viewerId,
}: {
  initial: CreatorProfile;
  viewerId: string;
}) {
  const [profile, setProfile] = useState(initial),
    [name, setName] = useState(initial.displayName ?? ""),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [conflict, setConflict] = useState(false),
    [invalid, setInvalid] = useState(false),
    [unresolved, setUnresolved] = useState(false);
  const request = useRef<AbortController | null>(null),
    command = useRef<SaveCreatorProfileRequest | null>(null),
    valid = useRef(true),
    owner = useRef(viewerId),
    currentName = useRef(name);
  currentName.current = name;
  useEffect(() => {
    valid.current = true;
    const invalidate = () => {
      valid.current = false;
      request.current?.abort();
      command.current = null;
      setName("");
      setProfile({ displayName: null, revision: 0 });
      setInvalid(true);
    };
    window.addEventListener("wyp:identity-invalidated", invalidate);
    if (owner.current !== viewerId) invalidate();
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, [viewerId]);
  function auth(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateAccountView();
      return true;
    }
    return false;
  }
  async function saveName() {
    if (request.current || !valid.current || conflict) return;
    const input = command.current ?? {
      requestId: crypto.randomUUID(),
      expectedRevision: profile.revision,
      displayName: normalizeCreatorDisplayName(name),
    };
    if (validateCreatorDisplayName(input.displayName).length) {
      setError(validateCreatorDisplayName(input.displayName)[0].message);
      return;
    }
    command.current = input;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveCreatorProfile(input, controller.signal);
      if (!valid.current || controller.signal.aborted) return;
      if (result.profile.revision < profile.revision)
        throw new Error("Stale profile response");
      setProfile(result.profile);
      command.current = null;
      setUnresolved(false);
      if (result.profile.displayName !== input.displayName) {
        setConflict(true);
        setError(
          "Your public name has since changed. Load the current name before saving again.",
        );
      } else {
        if (
          normalizeCreatorDisplayName(currentName.current) === input.displayName
        )
          setName(result.profile.displayName ?? "");
        setNotice(
          "Public name saved. Existing publications keep their original credit.",
        );
      }
    } catch (error) {
      if (controller.signal.aborted || !valid.current || auth(error)) return;
      const rejected =
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500;
      if (rejected) command.current = null;
      setUnresolved(!rejected);
      setConflict(error instanceof ApiClientError && error.status === 409);
      setError(
        rejected
          ? error.message
          : "We couldn’t confirm this name change. Retry the same save.",
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  async function reloadProfile() {
    if (request.current || command.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const latest = await getCreatorProfile(controller.signal);
      if (!valid.current || controller.signal.aborted) return;
      setProfile(latest);
      setName(latest.displayName ?? "");
      setConflict(false);
      setError(null);
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !auth(error))
        setError("Your public name couldn’t load. Try again.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }
  if (invalid) return <p role="status">Your sign-in changed. Refreshing…</p>;
  return (
    <section className="surface-card creator-profile">
      <h2>Your public creator name</h2>
      <p>
        This name appears on playlists you publish. It can differ from the
        players in your videos; your account email stays private.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void saveName();
        }}
      >
        <label htmlFor="creator-display-name">
          Public display name
          <input
            id="creator-display-name"
            value={name}
            maxLength={100}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="quiet-note">
          2–50 characters. Changing this name requires a fresh playlist review
          before publishing.
        </p>
        <button
          className="button button-secondary"
          disabled={pending || conflict}
        >
          {pending
            ? "Saving…"
            : unresolved
              ? "Retry the same name save"
              : "Save public name"}
        </button>
      </form>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {conflict && (
        <button
          className="text-button"
          disabled={pending}
          onClick={() => void reloadProfile()}
        >
          Load current public name
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
