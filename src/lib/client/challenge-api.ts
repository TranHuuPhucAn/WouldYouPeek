import type {
  AnswerRequest,
  AnswerResponse,
  Assessment,
  ChallengeDetail,
  ChallengeListResponse,
  ChallengeSummary,
  MediaAsset,
  DecisionAsset,
  ChallengeSource,
  AIAnalysis,
} from "@/contracts/challenge";
import { validateSegment } from "@/lib/video/segment-controller";

export class ChallengeApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ChallengeApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isText(value: unknown): value is string {
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
function isTextList(value: unknown): value is string[] {
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
function isAnalysis(value: unknown): value is AIAnalysis {
  return (
    isRecord(value) &&
    value.author === "ai" &&
    isText(value.notice) &&
    isText(value.rationale) &&
    isTextList(value.limitations)
  );
}
function isSummary(value: unknown): value is ChallengeSummary {
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
function invalidResponse(): never {
  throw new ChallengeApiError(
    "INVALID_RESPONSE",
    "The response was incomplete. Please try again.",
    200,
  );
}

async function readResponse<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ChallengeApiError(
      "INVALID_RESPONSE",
      "We couldn't read the response. Please try again.",
      response.status,
    );
  }
  if (!response.ok) {
    const failure =
      body && typeof body === "object" && "error" in body ? body.error : null;
    if (
      failure &&
      typeof failure === "object" &&
      "message" in failure &&
      typeof failure.message === "string"
    ) {
      throw new ChallengeApiError(
        "code" in failure && typeof failure.code === "string"
          ? failure.code
          : "REQUEST_FAILED",
        failure.message,
        response.status,
      );
    }
    throw new ChallengeApiError(
      "REQUEST_FAILED",
      "Something went wrong. Please try again.",
      response.status,
    );
  }
  if (!body || typeof body !== "object") {
    throw new ChallengeApiError(
      "INVALID_RESPONSE",
      "The response was incomplete. Please try again.",
      response.status,
    );
  }
  return body as T;
}

export async function getChallenges(signal?: AbortSignal) {
  const body = await readResponse<ChallengeListResponse>(
    await fetch("/api/challenges", { signal, cache: "no-store" }),
  );
  if (
    !Array.isArray(body.challenges) ||
    body.challenges.length === 0 ||
    !body.challenges.every(isSummary) ||
    new Set(body.challenges.map((challenge) => challenge.id)).size !==
      body.challenges.length
  )
    invalidResponse();
  return body.challenges;
}

export async function getChallenge(id: string, signal?: AbortSignal) {
  const body = await readResponse<ChallengeDetail>(
    await fetch(`/api/challenges/${encodeURIComponent(id)}`, {
      signal,
      cache: "no-store",
    }),
  );
  if (
    !isSummary(body) ||
    body.id !== id ||
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

export async function submitAnswer(
  id: string,
  request: AnswerRequest,
  signal?: AbortSignal,
) {
  const body = await readResponse<AnswerResponse>(
    await fetch(`/api/challenges/${encodeURIComponent(id)}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
      cache: "no-store",
    }),
  );
  if (
    body.challengeId !== id ||
    body.selectedOptionId !== request.optionId ||
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
        option.optionId === request.optionId &&
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
