import type {
  AnswerResponse,
  ChallengeDetail,
  ChallengeSummary,
} from "@/contracts/challenge";

export const challenges: ChallengeDetail[] = [
  "hold-the-advantage",
  "missed-shot-reset",
  "trade-the-contact",
].map((id, index) => ({
  id,
  title: [
    "Hold the advantage",
    "Missed shot. New angle.",
    "Stay close enough to trade",
  ][index],
  topic: "Angle discipline",
  order: index + 1,
  mediaStatus: "demo",
  contentVersion: "demo-1",
  context:
    "A teammate covers the other approach. You hold the doorway from cover.",
  setup: {
    kind: "illustration",
    src: `/demo/${id}/setup.svg`,
    alt: "Setup diagram",
  },
  decision: {
    kind: "image",
    imageUrl: `/demo/${id}/decision.svg`,
    alt: "Decision diagram",
  },
  options: [
    { id: "hold", label: "Hold the angle" },
    { id: "move", label: "Move to cover" },
    { id: "peek", label: "Swing the doorway" },
  ],
}));
export const summaries: ChallengeSummary[] = challenges.map(
  ({ id, title, topic, order, mediaStatus }) => ({
    id,
    title,
    topic,
    order,
    mediaStatus,
  }),
);

export function answerFor(
  challengeId = challenges[0].id,
  optionId = "hold",
): AnswerResponse {
  return {
    challengeId,
    contentVersion: "demo-1",
    selectedOptionId: optionId,
    selectedAssessment:
      optionId === "hold"
        ? "recommended"
        : optionId === "move"
          ? "reasonable"
          : "risky",
    recommendedOptionIds: ["hold"],
    optionFeedback: [
      {
        optionId: "hold",
        assessment: "recommended",
        explanation: "Holding keeps your advantage.",
        acceptableWhen: ["The other approach is covered."],
        risks: [],
      },
      {
        optionId: "move",
        assessment: "reasonable",
        explanation: "Moving can give up the doorway.",
        acceptableWhen: ["The angle has become unsafe."],
        risks: ["Giving up space."],
      },
      {
        optionId: "peek",
        assessment: "risky",
        explanation: "Swinging exposes you to a duel.",
        acceptableWhen: [],
        risks: ["An isolated fight."],
      },
    ],
    takeaway: "Make the opponent cross your angle.",
    reveal: {
      kind: "illustration",
      src: `/demo/${challengeId}/reveal.svg`,
      alt: "Outcome diagram",
    },
    outcomeText: "The defender crosses the held angle.",
  };
}
