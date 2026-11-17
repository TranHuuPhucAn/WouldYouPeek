import "server-only";
import type {
  AnswerRequest,
  AnswerResponse,
  ChallengeDetail,
  ChallengeSummary,
} from "@/contracts/challenge";
import { ApiError } from "@/server/http";
import { CHALLENGES, type AuthoredChallenge } from "./data";

function findChallenge(id: string): AuthoredChallenge {
  const challenge = CHALLENGES.find((entry) => entry.id === id);
  if (!challenge)
    throw new ApiError(
      "CHALLENGE_NOT_FOUND",
      "This challenge could not be found.",
    );
  return challenge;
}

function toSummary(challenge: AuthoredChallenge): ChallengeSummary {
  return {
    id: challenge.id,
    title: challenge.title,
    topic: challenge.topic,
    order: challenge.order,
    mediaStatus: challenge.mediaStatus,
  };
}

function toDetail(challenge: AuthoredChallenge): ChallengeDetail {
  return {
    ...toSummary(challenge),
    contentVersion: challenge.contentVersion,
    context: challenge.context,
    question: challenge.question,
    source: {
      kind: challenge.source.kind,
      videoId: challenge.source.videoId,
      url: challenge.source.url,
      title: challenge.source.title,
      uploader: challenge.source.uploader,
      player: challenge.source.player,
      matchType: challenge.source.matchType,
      map: challenge.source.map,
      agent: challenge.source.agent,
      round: challenge.source.round,
      score: challenge.source.score,
      side: challenge.source.side,
      ...(challenge.source.publishedDate
        ? { publishedDate: challenge.source.publishedDate }
        : {}),
      ...(challenge.source.dateNote
        ? { dateNote: challenge.source.dateNote }
        : {}),
    },
    knownFacts: [...challenge.knownFacts],
    unknowns: [...challenge.unknowns],
    ...(challenge.linkedScenarioId
      ? { linkedScenarioId: challenge.linkedScenarioId }
      : {}),
    setup: {
      kind: challenge.setup.kind,
      videoId: challenge.setup.videoId,
      startSeconds: challenge.setup.startSeconds,
      endSeconds: challenge.setup.endSeconds,
      alt: challenge.setup.alt,
      ...(challenge.setup.caption ? { caption: challenge.setup.caption } : {}),
    },
    decision: {
      kind: challenge.decision.kind,
      atSeconds: challenge.decision.atSeconds,
      alt: challenge.decision.alt,
    },
    options: challenge.options.map(({ id, label }) => ({ id, label })),
  };
}

export function listChallenges(): ChallengeSummary[] {
  return [...CHALLENGES].sort((a, b) => a.order - b.order).map(toSummary);
}

export function getChallenge(id: string): ChallengeDetail {
  return toDetail(findChallenge(id));
}

export function parseAnswerRequest(value: unknown): AnswerRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("optionId" in value) ||
    typeof value.optionId !== "string" ||
    value.optionId.trim().length === 0 ||
    value.optionId !== value.optionId.trim()
  ) {
    throw new ApiError(
      "INVALID_REQUEST",
      "Choose an option and submit only its optionId.",
    );
  }
  return { optionId: value.optionId };
}

export function submitAnswer(
  id: string,
  request: AnswerRequest,
): AnswerResponse {
  const challenge = findChallenge(id);
  const selected = challenge.options.find(
    (option) => option.id === request.optionId,
  );
  if (!selected)
    throw new ApiError(
      "INVALID_OPTION",
      "Choose one of this challenge's options.",
    );
  return {
    challengeId: challenge.id,
    contentVersion: challenge.contentVersion,
    selectedOptionId: selected.id,
    selectedAssessment: selected.assessment,
    recommendedOptionIds: challenge.options
      .filter((option) => option.assessment === "recommended")
      .map((option) => option.id),
    optionFeedback: challenge.options.map(
      ({ id: optionId, assessment, explanation, acceptableWhen, risks }) => ({
        optionId,
        assessment,
        explanation,
        acceptableWhen: [...acceptableWhen],
        risks: [...risks],
      }),
    ),
    takeaway: challenge.takeaway,
    reveal: { ...challenge.reveal },
    outcomeText: challenge.outcomeText,
    observedAction: {
      optionId: challenge.observedAction.optionId,
      description: challenge.observedAction.description,
    },
    matchesPro: selected.id === challenge.observedAction.optionId,
    analysis: {
      author: challenge.analysis.author,
      notice: challenge.analysis.notice,
      rationale: challenge.analysis.rationale,
      limitations: [...challenge.analysis.limitations],
    },
  };
}
