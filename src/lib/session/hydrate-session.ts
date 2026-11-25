import type { SessionSnapshot } from "@/contracts/session";
import type { CompletedChallenge, SessionState } from "./session-reducer";
export function getCompletedChallenges(
  snapshot: SessionSnapshot,
): CompletedChallenge[] {
  return snapshot.items.flatMap((item) =>
    item.answer
      ? [{ challenge: item.challenge, answer: item.answer.result }]
      : [],
  );
}
export function hydrateSessionSnapshot(
  snapshot: SessionSnapshot,
  viewerId: string,
): SessionState {
  const index = snapshot.currentIndex ?? snapshot.items.length - 1;
  const item = snapshot.status === "ended" ? undefined : snapshot.items[index];
  return {
    snapshot,
    viewerId,
    phase: snapshot.phase === "completed" ? "complete" : snapshot.phase,
    catalogue: snapshot.items.map((item) => item.challenge),
    currentIndex: index,
    challenge: item?.challenge ?? null,
    selectedOptionId: item?.answer?.result.selectedOptionId ?? null,
    feedback: item?.answer?.result ?? null,
    completed: getCompletedChallenges(snapshot),
    reviewMedia: "outcome",
    error: null,
    pending: false,
    unresolved: false,
  };
}
