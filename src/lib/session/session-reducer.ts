import type {
  AnswerResponse,
  ChallengeDetail,
  ChallengeSummary,
} from "@/contracts/challenge";
import type { SessionSnapshot } from "@/contracts/session";
import { hydrateSessionSnapshot } from "./hydrate-session";
export type CompletedChallenge = {
  challenge: ChallengeDetail;
  answer: AnswerResponse;
};
export type SessionState = {
  snapshot: SessionSnapshot;
  viewerId: string;
  phase:
    | "setup"
    | "decision"
    | "submitting"
    | "review"
    | "complete"
    | "auth-required";
  catalogue: ChallengeSummary[];
  currentIndex: number;
  challenge: ChallengeDetail | null;
  selectedOptionId: string | null;
  feedback: AnswerResponse | null;
  completed: CompletedChallenge[];
  reviewMedia: "setup" | "outcome";
  error: string | null;
  pending: boolean;
  unresolved: boolean;
};
export type SessionAction =
  | { type: "HYDRATE"; snapshot: SessionSnapshot; viewerId: string }
  | { type: "SETUP_FINISHED"; challengeId?: string }
  | { type: "SELECT_OPTION"; optionId: string }
  | { type: "REPLAY_SETUP" | "COMMAND_STARTED" | "AUTH_REQUIRED" }
  | { type: "COMMAND_FAILED"; message: string; unresolved: boolean }
  | { type: "SET_REVIEW_MEDIA"; media: "setup" | "outcome" };
export function createInitialSessionState(input: {
  snapshot: SessionSnapshot;
  viewerId: string;
}): SessionState {
  return hydrateSessionSnapshot(input.snapshot, input.viewerId);
}
export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  if (action.type === "AUTH_REQUIRED")
    return {
      ...state,
      phase: "auth-required",
      challenge: null,
      feedback: null,
      completed: [],
      selectedOptionId: null,
      pending: false,
      error: null,
    };
  if (state.phase === "auth-required") return state;
  switch (action.type) {
    case "HYDRATE":
      if (
        action.viewerId !== state.viewerId ||
        action.snapshot.id !== state.snapshot.id ||
        action.snapshot.revision < state.snapshot.revision
      )
        return state;
      return hydrateSessionSnapshot(action.snapshot, action.viewerId);
    case "SETUP_FINISHED":
      return state.phase === "setup" &&
        (!action.challengeId || action.challengeId === state.challenge?.id)
        ? { ...state, phase: "decision" }
        : state;
    case "SELECT_OPTION":
      return state.phase === "decision" &&
        !state.unresolved &&
        state.challenge?.options.some((item) => item.id === action.optionId)
        ? { ...state, selectedOptionId: action.optionId, error: null }
        : state;
    case "REPLAY_SETUP":
      return state.phase === "decision" && !state.unresolved
        ? { ...state, phase: "setup" }
        : state;
    case "COMMAND_STARTED":
      return {
        ...state,
        phase: state.phase === "decision" ? "submitting" : state.phase,
        pending: true,
        error: null,
      };
    case "COMMAND_FAILED":
      return {
        ...state,
        phase: state.phase === "submitting" ? "decision" : state.phase,
        pending: false,
        error: action.message,
        unresolved: action.unresolved,
      };
    case "SET_REVIEW_MEDIA":
      return state.phase === "review"
        ? { ...state, reviewMedia: action.media }
        : state;
    default:
      return state;
  }
}
