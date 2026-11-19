import type { AnswerResponse, ChallengeDetail } from "@/contracts/challenge";
export type PreviewData = {
  challenge: ChallengeDetail;
  feedbackByOption: Record<string, AnswerResponse>;
};
export type PreviewState = {
  phase: "setup" | "decision" | "review";
  selectedOptionId: string | null;
  reviewMedia: "setup" | "outcome";
  attempt: number;
};
export function createPreviewState(): PreviewState {
  return {
    phase: "setup",
    selectedOptionId: null,
    reviewMedia: "outcome",
    attempt: 0,
  };
}
export function selectPreviewFeedback(preview: PreviewData, optionId: string) {
  if (!preview.challenge.options.some((option) => option.id === optionId))
    return null;
  return preview.feedbackByOption[optionId] ?? null;
}
export function previewReducer(
  state: PreviewState,
  action:
    | { type: "SETUP_COMPLETE" }
    | { type: "SELECT"; optionId: string }
    | { type: "SUBMIT" }
    | { type: "REPLAY_SETUP" }
    | { type: "MEDIA"; media: "setup" | "outcome" }
    | { type: "RESET" },
): PreviewState {
  switch (action.type) {
    case "SETUP_COMPLETE":
      return state.phase === "setup" ? { ...state, phase: "decision" } : state;
    case "SELECT":
      return state.phase === "decision"
        ? { ...state, selectedOptionId: action.optionId }
        : state;
    case "SUBMIT":
      return state.phase === "decision" && state.selectedOptionId
        ? { ...state, phase: "review", reviewMedia: "outcome" }
        : state;
    case "REPLAY_SETUP":
      return state.phase === "decision" ? { ...state, phase: "setup" } : state;
    case "MEDIA":
      return state.phase === "review"
        ? { ...state, reviewMedia: action.media }
        : state;
    case "RESET":
      return { ...createPreviewState(), attempt: state.attempt + 1 };
  }
}
