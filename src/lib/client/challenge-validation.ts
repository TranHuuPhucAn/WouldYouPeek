import type {
  AnswerResponse,
  Assessment,
  ChallengeDetail,
  ChallengeSummary,
  ChallengePreview,
  MediaAsset,
  DecisionAsset,
  ChallengeSource,
  ScenarioAnalysis,
} from "@/contracts/challenge";
import { validateSegment } from "@/lib/video/segment-controller";

import { ApiClientError as ChallengeApiError } from "./api-response";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isAssessment(value: unknown): value is Assessment {
  return value === "recommended" || value === "reasonable" || value === "risky";
}
function isMedia(value: unknown): value is MediaAsset {
  if (
    !isRecord(value) ||
    !isText(value.alt) ||
    (value.caption !== undefined && !isText(value.caption))
  )
    return false;
  if (value.kind === "youtube")
    return (
      isText(value.videoId) &&
      /^[\w-]{11}$/.test(value.videoId) &&
      typeof value.startSeconds === "number" &&
      typeof value.endSeconds === "number" &&
      validateSegment({
        startSeconds: value.startSeconds,
        endSeconds: value.endSeconds,
      })
    );
  return (
    (value.kind === "video" || value.kind === "illustration") &&
    isText(value.src)
  );
}
export function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText);
}
function isDecision(value: unknown): value is DecisionAsset {
  if (!isRecord(value) || !isText(value.alt)) return false;
  return value.kind === "image"
    ? isText(value.imageUrl)
    : value.kind === "paused-video" &&
        typeof value.atSeconds === "number" &&
        Number.isFinite(value.atSeconds) &&
        value.atSeconds >= 0;
}
function isSource(value: unknown): value is ChallengeSource {
  if (
    !isRecord(value) ||
    value.kind !== "youtube" ||
    !isText(value.videoId) ||
    !/^[\w-]{11}$/.test(value.videoId) ||
    !["url", "title", "uploader", "player", "map", "agent", "score"].every(
      (key) => isText(value[key]),
    ) ||
    !["ranked", "tournament"].includes(String(value.matchType)) ||
    !["attack", "defense"].includes(String(value.side)) ||
    typeof value.round !== "number" ||
    !Number.isInteger(value.round) ||
    value.round < 1 ||
    (value.publishedDate !== undefined && !isText(value.publishedDate)) ||
    (value.dateNote !== undefined && !isText(value.dateNote))
  )
    return false;
  try {
    const url = new URL(String(value.url));
    return (
      url.protocol === "https:" &&
      ["youtube.com", "www.youtube.com"].includes(url.hostname) &&
      url.pathname === "/watch" &&
      url.searchParams.get("v") === value.videoId
    );
  } catch {
    return false;
  }
}
function isAnalysis(value: unknown): value is ScenarioAnalysis {
  return (
    isRecord(value) &&
    ["ai", "creator", "ai-assisted"].includes(String(value.author)) &&
    isText(value.notice) &&
    isText(value.rationale) &&
    isTextList(value.limitations)
  );
}
function isSummary(
  value: unknown,
): value is ChallengeSummary & Record<string, unknown> {
  return (
    isRecord(value) &&
    isText(value.id) &&
    isText(value.title) &&
    isText(value.topic) &&
    typeof value.order === "number" &&
    Number.isFinite(value.order) &&
    (value.mediaStatus === "ready" || value.mediaStatus === "demo")
  );
}
export function invalidResponse(): never {
  throw new ChallengeApiError(
    "INVALID_RESPONSE",
    "The response was incomplete. Please try again.",
    200,
  );
}

export function parseChallengePreview(value: unknown): ChallengePreview {
  if (
    !isRecord(value) ||
    !isSummary(value) ||
    !isText(value.context) ||
    !isMedia(value.setup) ||
    (value.source !== undefined && !isSource(value.source)) ||
    Object.keys(value).some(
      (key) =>
        ![
          "id",
          "title",
          "topic",
          "order",
          "mediaStatus",
          "context",
          "source",
          "setup",
        ].includes(key),
    )
  )
    invalidResponse();
  const body = value as ChallengePreview;
  if (
    body.setup.kind === "youtube" &&
    (!body.source ||
      body.source.videoId !== body.setup.videoId ||
      body.mediaStatus !== "ready")
  )
    invalidResponse();
  return body;
}
export function parseChallengeDetail(value: unknown): ChallengeDetail {
  if (!isRecord(value)) invalidResponse();
  const body = value as ChallengeDetail;
  if (
    !isSummary(body) ||
    !isText(body.contentVersion) ||
    !isText(body.context) ||
    !isMedia(body.setup) ||
    !isDecision(body.decision) ||
    (body.question !== undefined && !isText(body.question)) ||
    (body.source !== undefined && !isSource(body.source)) ||
    (body.knownFacts !== undefined && !isTextList(body.knownFacts)) ||
    (body.unknowns !== undefined && !isTextList(body.unknowns)) ||
    (body.linkedScenarioId !== undefined &&
      (!isText(body.linkedScenarioId) || body.linkedScenarioId === body.id)) ||
    !Array.isArray(body.options) ||
    !body.options.length ||
    !body.options.every(
      (option) => isRecord(option) && isText(option.id) && isText(option.label),
    ) ||
    new Set(body.options.map((option) => option.id)).size !==
      body.options.length
  )
    invalidResponse();
  if (body.setup.kind === "youtube") {
    if (
      !body.source ||
      body.source.videoId !== body.setup.videoId ||
      body.decision.kind !== "paused-video" ||
      body.decision.atSeconds !== body.setup.endSeconds ||
      !body.question ||
      !body.knownFacts?.length ||
      !body.unknowns ||
      body.mediaStatus !== "ready"
    )
      invalidResponse();
  } else if (body.decision.kind !== "image") invalidResponse();
  return body;
}

export function parseAnswerResponse(value: unknown): AnswerResponse {
  if (!isRecord(value)) invalidResponse();
  const body = value as AnswerResponse;
  if (
    !isText(body.challengeId) ||
    !isText(body.selectedOptionId) ||
    !isText(body.contentVersion) ||
    !isAssessment(body.selectedAssessment) ||
    !Array.isArray(body.recommendedOptionIds) ||
    !body.recommendedOptionIds.every(isText) ||
    !Array.isArray(body.optionFeedback) ||
    !body.optionFeedback.length ||
    !body.optionFeedback.every(
      (option) =>
        isRecord(option) &&
        isText(option.optionId) &&
        isAssessment(option.assessment) &&
        isText(option.explanation) &&
        isTextList(option.acceptableWhen) &&
        isTextList(option.risks),
    ) ||
    !body.optionFeedback.some(
      (option) =>
        option.optionId === body.selectedOptionId &&
        option.assessment === body.selectedAssessment,
    ) ||
    !isText(body.takeaway) ||
    !isMedia(body.reveal) ||
    !isText(body.outcomeText)
  )
    invalidResponse();
  const optionIds = body.optionFeedback.map((option) => option.optionId);
  const recommended = body.optionFeedback
    .filter((option) => option.assessment === "recommended")
    .map((option) => option.optionId);
  if (
    new Set(optionIds).size !== optionIds.length ||
    new Set(body.recommendedOptionIds).size !==
      body.recommendedOptionIds.length ||
    recommended.length !== body.recommendedOptionIds.length ||
    !recommended.every((id) => body.recommendedOptionIds.includes(id))
  )
    invalidResponse();
  const hasComparison =
    body.observedAction !== undefined ||
    body.matchesPro !== undefined ||
    body.analysis !== undefined;
  if (hasComparison || body.reveal.kind === "youtube") {
    if (
      !isRecord(body.observedAction) ||
      !isText(body.observedAction.optionId) ||
      !isText(body.observedAction.description) ||
      !optionIds.includes(body.observedAction.optionId) ||
      typeof body.matchesPro !== "boolean" ||
      !isAnalysis(body.analysis) ||
      body.matchesPro !==
        (body.selectedOptionId === body.observedAction.optionId)
    )
      invalidResponse();
  }
  return body;
}

/** Cross-check answer data against the challenge the learner actually answered. */
export function validateAnswerForChallenge(
  answer: AnswerResponse,
  challenge: ChallengeDetail,
): void {
  const ids = challenge.options.map((option) => option.id);
  if (
    answer.challengeId !== challenge.id ||
    answer.contentVersion !== challenge.contentVersion ||
    answer.optionFeedback.length !== ids.length ||
    !answer.optionFeedback.every((option) => ids.includes(option.optionId))
  )
    invalidResponse();
  if (challenge.setup.kind === "youtube") {
    if (
      answer.reveal.kind !== "youtube" ||
      answer.reveal.videoId !== challenge.setup.videoId ||
      answer.reveal.startSeconds !== challenge.setup.endSeconds ||
      !answer.observedAction ||
      !ids.includes(answer.observedAction.optionId) ||
      !answer.analysis ||
      typeof answer.matchesPro !== "boolean"
    )
      invalidResponse();
  } else if (
    challenge.mediaStatus === "demo" &&
    answer.observedAction !== undefined
  )
    invalidResponse();
}
