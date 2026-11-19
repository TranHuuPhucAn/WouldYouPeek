"use client";
import { useEffect, useReducer, useRef } from "react";
import type {
  CreatorDraftContent,
  CreatorScenarioSnapshot,
} from "@/contracts/creator";
import { normalizeDraftContent } from "@/lib/creator/content";
import {
  buildDraftCommand,
  createEditorState,
  editorReducer,
  isEditorDirty,
  type DraftSaveCommand,
} from "@/lib/creator/editor-state";
import {
  getCreatorScenario,
  saveCreatorScenario,
} from "@/lib/client/creator-api";
import { ApiClientError } from "@/lib/client/api-response";
import { validateCreatorContinuity } from "@/lib/client/creator-validation";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";

export function useScenarioEditor(
  initial: CreatorScenarioSnapshot,
  viewerId: string,
) {
  const [state, dispatch] = useReducer(
    editorReducer,
    initial,
    createEditorState,
  );
  const current = useRef(state);
  current.current = state;
  const request = useRef<AbortController | null>(null);
  const valid = useRef(true);
  const owner = useRef(viewerId);
  function invalidateIdentity() {
    valid.current = false;
    request.current?.abort();
    request.current = null;
    dispatch({ type: "INVALIDATE" });
  }
  useEffect(() => {
    valid.current = true;
    window.addEventListener("wyp:identity-invalidated", invalidateIdentity);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener(
        "wyp:identity-invalidated",
        invalidateIdentity,
      );
    };
  }, []);
  useEffect(() => {
    if (
      viewerId !== owner.current ||
      initial.id !== current.current.snapshot.id
    )
      invalidateIdentity();
  }, [initial.id, viewerId]);
  function authFailure(error: unknown) {
    if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
      invalidateIdentity();
      invalidateAccountView();
      return true;
    }
    return false;
  }
  async function execute(command: DraftSaveCommand) {
    if (request.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    dispatch({ type: "START", command });
    try {
      const response = await saveCreatorScenario(
        initial.id,
        { ...command, content: normalizeDraftContent(command.content) },
        controller.signal,
      );
      if (controller.signal.aborted || !valid.current) return;
      validateCreatorContinuity(response.scenario, current.current.snapshot);
      dispatch({
        type: "SAVED",
        snapshot: response.scenario,
        submitted: command.content,
      });
    } catch (error) {
      if (controller.signal.aborted || !valid.current || authFailure(error))
        return;
      const conflict = error instanceof ApiClientError && error.status === 409;
      const rejected =
        error instanceof ApiClientError &&
        error.status >= 400 &&
        error.status < 500;
      dispatch({
        type: "FAILED",
        conflict,
        retainCommand: !rejected,
        message: conflict
          ? "Another change was saved. Compare with the latest draft before continuing; your local text is still here."
          : rejected
            ? error.message
            : "We couldn’t confirm this save. Retry the same save before submitting more changes.",
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  function saveDraft() {
    if (current.current.conflict) return;
    if (current.current.command) return execute(current.current.command);
    const command = buildDraftCommand(current.current, crypto.randomUUID());
    return execute(command);
  }
  async function fetchLatest() {
    if (request.current || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const snapshot = await getCreatorScenario(initial.id, controller.signal);
      if (!controller.signal.aborted && valid.current) {
        validateCreatorContinuity(snapshot, current.current.snapshot);
        dispatch({ type: "LATEST", snapshot });
      }
    } catch (error) {
      if (!controller.signal.aborted && valid.current && !authFailure(error))
        dispatch({
          type: "FAILED",
          conflict: current.current.conflict,
          retainCommand: !!current.current.command,
          message:
            "The latest draft couldn’t load. Your edits are still here; try again.",
        });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  return {
    state,
    dirty: isEditorDirty(state),
    saveDraft,
    retrySave: () => state.command && execute(state.command),
    fetchLatest,
    acceptLatest: () => {
      if (!current.current.command) dispatch({ type: "ACCEPT_LATEST" });
    },
    invalidateIdentity,
    update: (content: CreatorDraftContent) =>
      dispatch({ type: "EDIT", content }),
  };
}
