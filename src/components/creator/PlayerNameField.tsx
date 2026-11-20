"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ValidationIssue } from "@/contracts/creator";
import type { PlayerSummary } from "@/contracts/player";
import { listLibraryPlayers } from "@/lib/client/library-api";
import {
  normalizePlayerKey,
  SOURCE_PLAYER_MAX_CODE_POINTS,
} from "@/lib/players/identity";
import { fieldId } from "./EditorFields";

export function PlayerNameField({
  value,
  onChange,
  issues = [],
}: {
  value: string;
  onChange: (value: string) => void;
  issues?: ValidationIssue[];
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [suggestions, setSuggestions] = useState<PlayerSummary[]>([]);
  const [failed, setFailed] = useState(false);
  const limitError =
    [...value].length > SOURCE_PLAYER_MAX_CODE_POINTS
      ? `Use at most ${SOURCE_PLAYER_MAX_CODE_POINTS} characters for the player in the recording.`
      : undefined;
  const error =
    limitError ??
    issues.find((issue) => issue.path === "source.player")?.message;
  const id = fieldId("source.player");
  useEffect(() => {
    input.current?.setCustomValidity(limitError ?? "");
  }, [limitError]);
  useEffect(() => {
    if (!active) return;
    let query = "";
    try {
      // The catalogue search is bounded separately from the authored credit.
      query = [...normalizePlayerKey(value)].slice(0, 100).join("");
    } catch {
      if (value.trim()) return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void listLibraryPlayers({ query }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setSuggestions(
              result.players
                .map((group) => group.player)
                .filter(
                  (player) =>
                    [...player.displayName].length <=
                    SOURCE_PLAYER_MAX_CODE_POINTS,
                ),
            );
            setFailed(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setFailed(true);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, value]);
  return (
    <div className="creator-field">
      <label htmlFor={id}>Player in the recording</label>
      <input
        id={id}
        ref={input}
        name="source.player"
        value={value}
        list={listId}
        maxLength={SOURCE_PLAYER_MAX_CODE_POINTS * 2}
        autoComplete="off"
        onFocus={() => setActive(true)}
        onChange={(event) => {
          setActive(true);
          setSuggestions([]);
          onChange(event.target.value);
        }}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
      />
      <datalist id={listId}>
        {suggestions.map((player) => (
          <option key={player.id} value={player.displayName} />
        ))}
      </datalist>
      <small id={`${id}-hint`}>
        {failed
          ? "Suggestions are unavailable. You can still enter any player name."
          : "Choose an existing name or enter a new one. Names are grouped when you publish."}
      </small>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
