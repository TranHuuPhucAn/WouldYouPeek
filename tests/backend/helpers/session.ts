import type { SessionSnapshot } from "@/contracts/session";
import {
  getChallenge,
  listChallenges,
  submitAnswer,
} from "../../fixtures/authored-challenges";
export const sessionId = "11111111-1111-4111-8111-111111111111";
export const requestId = "22222222-2222-4222-8222-222222222222";
export function snapshot(): SessionSnapshot {
  return {
    id: sessionId,
    target: { kind: "demo" },
    title: "Three-scenario demo",
    status: "in_progress",
    phase: "setup",
    revision: 0,
    currentIndex: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    items: listChallenges().map((summary, index) => ({
      id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
      position: index,
      challenge: getChallenge(summary.id),
      answer: null,
    })),
  };
}
export function reviewSnapshot(index = 0): SessionSnapshot {
  const result = snapshot();
  result.phase = "review";
  result.currentIndex = index;
  result.revision = index * 2 + 1;
  for (const item of result.items.slice(0, index + 1))
    item.answer = {
      id: `44444444-4444-4444-8444-${String(item.position + 1).padStart(12, "0")}`,
      answeredAt: "2026-01-01T00:01:00Z",
      result: submitAnswer(item.challenge.id, {
        optionId: item.challenge.options[0].id,
      }),
    };
  return result;
}
