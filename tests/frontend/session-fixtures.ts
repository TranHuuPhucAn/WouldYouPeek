import type { AccountUser } from "@/contracts/auth";
import type { SessionSnapshot } from "@/contracts/session";
import { challenges, answerFor } from "./fixtures";
export const viewer: AccountUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "learner@example.test",
  emailVerified: true,
  role: "learner",
  capabilities: ["learn"],
  createdAt: "2026-11-17T00:00:00.000Z",
};
export const sessionId = "22222222-2222-4222-8222-222222222222";
export function snapshot(
  phase: SessionSnapshot["phase"] = "setup",
  index = 0,
): SessionSnapshot {
  return {
    id: sessionId,
    target: { kind: "demo" },
    title: "TenZ · Clove · Bind",
    status: phase === "completed" ? "completed" : "in_progress",
    phase,
    revision:
      phase === "completed" ? 6 : index * 2 + (phase === "review" ? 1 : 0),
    currentIndex: phase === "completed" ? null : index,
    createdAt: viewer.createdAt,
    updatedAt: viewer.createdAt,
    completedAt: phase === "completed" ? viewer.createdAt : null,
    items: challenges.map((challenge, position) => ({
      id: `33333333-3333-4333-8333-33333333333${position}`,
      position,
      challenge,
      answer:
        phase === "completed" ||
        position < index ||
        (position === index && phase === "review")
          ? {
              id: `44444444-4444-4444-8444-44444444444${position}`,
              answeredAt: viewer.createdAt,
              result: answerFor(challenge.id),
            }
          : null,
    })),
  };
}
export function sessionSummary(phase: SessionSnapshot["phase"] = "setup") {
  const value = snapshot(phase);
  return {
    id: value.id,
    target: value.target,
    title: value.title,
    status: value.status,
    answeredCount: value.items.filter((item) => item.answer).length,
    totalCount: value.items.length,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
  };
}
