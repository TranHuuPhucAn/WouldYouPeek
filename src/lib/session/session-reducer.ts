import type {
  AnswerResponse,
  ChallengeDetail,
  ChallengeSummary,
} from "@/contracts/challenge";

export type CompletedChallenge = {
  challenge: ChallengeDetail;
  answer: AnswerResponse;
};
export type SessionState = {
  phase:
    | "loading"
    | "setup"
    | "decision"
    | "submitting"
    | "review"
    | "complete"
    | "error";
  loadTarget: "catalogue" | "challenge";
  catalogue: ChallengeSummary[];
  currentIndex: number;
  challenge: ChallengeDetail | null;
  selectedOptionId: string | null;
  feedback: AnswerResponse | null;
  completed: CompletedChallenge[];
  reviewMedia: "setup" | "outcome";
  error: string | null;
};
export type SessionAction =
  | { type: "CATALOGUE_LOADED"; challenges: ChallengeSummary[] }
  | { type: "CHALLENGE_LOADED"; challenge: ChallengeDetail }
  | { type: "LOAD_FAILED"; message: string }
  | {
      type:
        | "REPLAY_SETUP"
        | "SUBMIT_STARTED"
        | "NEXT_CHALLENGE"
        | "RETRY_LOAD"
        | "RESTART";
    }
  | { type: "SETUP_FINISHED"; challengeId?: string }
  | { type: "SELECT_OPTION"; optionId: string }
  | { type: "SUBMIT_SUCCEEDED"; answer: AnswerResponse }
  | { type: "SUBMIT_FAILED"; message: string }
  | { type: "SET_REVIEW_MEDIA"; media: "setup" | "outcome" };

export function createInitialSessionState(): SessionState {
  return {
    phase: "loading",
    loadTarget: "catalogue",
    catalogue: [],
    currentIndex: 0,
    challenge: null,
    selectedOptionId: null,
    feedback: null,
    completed: [],
    reviewMedia: "outcome",
    error: null,
  };
}

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "RESTART":
      return createInitialSessionState();
    case "CATALOGUE_LOADED":
      if (state.phase !== "loading" || state.loadTarget !== "catalogue")
        return state;
      if (!action.challenges.length)
        return {
          ...state,
          phase: "error",
          error: "There are no scenarios available yet.",
        };
      return {
        ...state,
        catalogue: action.challenges,
        loadTarget: "challenge",
      };
    case "CHALLENGE_LOADED":
      if (
        state.phase !== "loading" ||
        action.challenge.id !== state.catalogue[state.currentIndex]?.id
      )
        return state;
      return {
        ...state,
        phase: "setup",
        challenge: action.challenge,
        error: null,
      };
    case "LOAD_FAILED":
      return state.phase === "loading"
        ? { ...state, phase: "error", error: action.message }
        : state;
    case "RETRY_LOAD":
      return state.phase === "error"
        ? { ...state, phase: "loading", error: null }
        : state;
    case "SETUP_FINISHED":
      return state.phase === "setup" &&
        (!action.challengeId || action.challengeId === state.challenge?.id)
        ? { ...state, phase: "decision" }
        : state;
    case "REPLAY_SETUP":
      return state.phase === "decision" ? { ...state, phase: "setup" } : state;
    case "SELECT_OPTION":
      if (
        state.phase !== "decision" ||
        !state.challenge?.options.some(
          (option) => option.id === action.optionId,
        )
      )
        return state;
      return { ...state, selectedOptionId: action.optionId, error: null };
    case "SUBMIT_STARTED":
      return state.phase === "decision" && state.selectedOptionId
        ? { ...state, phase: "submitting", error: null }
        : state;
    case "SUBMIT_FAILED":
      return state.phase === "submitting"
        ? { ...state, phase: "decision", error: action.message }
        : state;
    case "SUBMIT_SUCCEEDED":
      if (
        state.phase !== "submitting" ||
        !state.challenge ||
        action.answer.challengeId !== state.challenge.id ||
        action.answer.selectedOptionId !== state.selectedOptionId
      )
        return state;
      return {
        ...state,
        phase: "review",
        feedback: action.answer,
        reviewMedia: "outcome",
        completed: [
          ...state.completed,
          { challenge: state.challenge, answer: action.answer },
        ],
        error: null,
      };
    case "SET_REVIEW_MEDIA":
      return state.phase === "review"
        ? { ...state, reviewMedia: action.media }
        : state;
    case "NEXT_CHALLENGE":
      if (state.phase !== "review") return state;
      if (state.currentIndex + 1 >= state.catalogue.length)
        return { ...state, phase: "complete" };
      return {
        ...state,
        phase: "loading",
        loadTarget: "challenge",
        currentIndex: state.currentIndex + 1,
        challenge: null,
        selectedOptionId: null,
        feedback: null,
        error: null,
      };
    default:
      return state;
  }
}
