"use client";
import { useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import type {
  AdvanceSessionRequest,
  AnswerSessionRequest,
  SessionSnapshot,
} from "@/contracts/session";
import {
  advanceSession,
  answerSessionItem,
  createOrResumeSession,
  getSession,
  validateSessionContinuity,
} from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import {
  createInitialSessionState,
  sessionReducer,
} from "@/lib/session/session-reducer";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";

type PendingCommand =
  | { kind: "answer"; itemId: string; input: AnswerSessionRequest }
  | { kind: "advance"; input: AdvanceSessionRequest };
export function useChallengeSession(
  initialSession: SessionSnapshot,
  viewerId: string,
) {
  const router = useRouter();
  const [state, dispatch] = useReducer(
    sessionReducer,
    { snapshot: initialSession, viewerId },
    createInitialSessionState,
  );
  const request = useRef<AbortController | null>(null);
  const command = useRef<PendingCommand | null>(null);
  const startId = useRef<string | null>(null);
  const valid = useRef(true);
  const current = useRef(state);
  current.current = state;
  function invalidateIdentity() {
    valid.current = false;
    request.current?.abort();
    request.current = null;
    command.current = null;
    dispatch({ type: "AUTH_REQUIRED" });
  }
  useEffect(() => {
    valid.current = true;
    const invalidate = () => invalidateIdentity();
    window.addEventListener("wyp:identity-invalidated", invalidate);
    return () => {
      valid.current = false;
      request.current?.abort();
      window.removeEventListener("wyp:identity-invalidated", invalidate);
    };
  }, []);
  useEffect(() => {
    if (viewerId !== current.current.viewerId) {
      invalidateIdentity();
      return;
    }
    if (initialSession.revision > current.current.snapshot.revision) {
      command.current = null;
      dispatch({ type: "HYDRATE", snapshot: initialSession, viewerId });
    }
  }, [initialSession, viewerId]);
  function authFailure(error: unknown) {
    if (
      error instanceof ApiClientError &&
      (error.status === 401 || error.code === "EMAIL_NOT_VERIFIED")
    ) {
      invalidateIdentity();
      invalidateAccountView();
      router.refresh();
      return true;
    }
    return false;
  }
  async function reconcileSession(controller?: AbortController, apply = true) {
    const own = controller ?? new AbortController();
    const snapshot = await getSession(initialSession.id, own.signal);
    validateSessionContinuity(snapshot, current.current.snapshot);
    if (apply && !own.signal.aborted && valid.current)
      dispatch({ type: "HYDRATE", snapshot, viewerId });
    return snapshot;
  }
  async function execute(pending: PendingCommand) {
    if (request.current || !valid.current) return;
    command.current = pending;
    const controller = new AbortController();
    request.current = controller;
    dispatch({ type: "COMMAND_STARTED" });
    try {
      const response =
        pending.kind === "answer"
          ? await answerSessionItem(
              initialSession.id,
              pending.itemId,
              pending.input,
              controller.signal,
            )
          : await advanceSession(
              initialSession.id,
              pending.input,
              controller.signal,
            );
      validateSessionContinuity(response.session, current.current.snapshot);
      if (!controller.signal.aborted && valid.current) {
        command.current = null;
        dispatch({ type: "HYDRATE", snapshot: response.session, viewerId });
      }
    } catch (error) {
      if (controller.signal.aborted || !valid.current || authFailure(error))
        return;
      const conflict = error instanceof ApiClientError && error.status === 409;
      try {
        const snapshot = await reconcileSession(controller, false);
        if (controller.signal.aborted || !valid.current) return;
        const item =
          pending.kind === "answer"
            ? snapshot.items.find((item) => item.id === pending.itemId)
            : snapshot.items.find(
                (item) => item.id === pending.input.fromItemId,
              );
        const resolved =
          pending.kind === "answer"
            ? !!item?.answer
            : snapshot.status === "completed" ||
              (!!item && snapshot.currentIndex! > item.position);
        if (resolved || conflict) {
          command.current = null;
          dispatch({ type: "HYDRATE", snapshot, viewerId });
          return;
        }
      } catch (reconcileError) {
        if (
          controller.signal.aborted ||
          !valid.current ||
          authFailure(reconcileError)
        )
          return;
      }
      const rejected = error instanceof ApiClientError && error.status === 400;
      if (rejected) command.current = null;
      dispatch({
        type: "COMMAND_FAILED",
        message: rejected
          ? "That choice couldn’t be saved. Please check your selection and try again."
          : "We couldn’t confirm the save. Retry to check and safely continue.",
        unresolved: !rejected,
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  async function submitSelection() {
    if (command.current) return execute(command.current);
    if (state.phase !== "decision" || !state.selectedOptionId || !valid.current)
      return;
    return execute({
      kind: "answer",
      itemId: state.snapshot.items[state.currentIndex].id,
      input: {
        optionId: state.selectedOptionId,
        requestId: crypto.randomUUID(),
        expectedRevision: state.snapshot.revision,
      },
    });
  }
  async function advance() {
    if (command.current) return execute(command.current);
    if (state.phase !== "review" || !valid.current) return;
    return execute({
      kind: "advance",
      input: {
        fromItemId: state.snapshot.items[state.currentIndex].id,
        requestId: crypto.randomUUID(),
        expectedRevision: state.snapshot.revision,
      },
    });
  }
  async function createNextSession() {
    if (request.current || state.phase !== "complete" || !valid.current) return;
    const controller = new AbortController();
    request.current = controller;
    startId.current ??= crypto.randomUUID();
    dispatch({ type: "COMMAND_STARTED" });
    try {
      const response = await createOrResumeSession(
        { requestId: startId.current, target: state.snapshot.target },
        controller.signal,
      );
      if (!controller.signal.aborted && valid.current)
        router.push(`/play/${response.session.id}`);
    } catch (error) {
      if (!controller.signal.aborted && !authFailure(error))
        dispatch({
          type: "COMMAND_FAILED",
          message:
            error instanceof ApiClientError &&
            error.code === "SCENARIO_UNAVAILABLE"
              ? "This scenario is no longer available for new sessions. Your saved history is still here. Choose another in the library."
              : error instanceof ApiClientError &&
                  error.code === "ACTIVE_SESSION_EXISTS"
                ? "Another session is active. Open Play to resume it before starting again."
                : "Your new session couldn’t open. Please try again.",
          unresolved: false,
        });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  return {
    state,
    submitSelection,
    advance,
    nextChallenge: advance,
    retrySave: () => (command.current ? execute(command.current) : undefined),
    createNextSession,
    restart: createNextSession,
    invalidateIdentity,
    completeSetup: () =>
      dispatch({ type: "SETUP_FINISHED", challengeId: state.challenge?.id }),
    selectOption: (optionId: string) =>
      dispatch({ type: "SELECT_OPTION", optionId }),
    replaySetup: () => dispatch({ type: "REPLAY_SETUP" }),
    showReviewSetup: () =>
      dispatch({ type: "SET_REVIEW_MEDIA", media: "setup" }),
    showReviewOutcome: () =>
      dispatch({ type: "SET_REVIEW_MEDIA", media: "outcome" }),
  };
}
