import "server-only";
import type { ChallengeDetail, ChallengePreview } from "@/contracts/challenge";
import type {
  SavedAnswer,
  SessionSnapshot,
  SessionSummary,
  SessionMutationResponse,
  CreateSessionResponse,
  SessionHistoryResponse,
} from "@/contracts/session";
import {
  parseChallengeDetail,
  parseChallengePreview,
  parseAnswerResponse,
  validateAnswerForChallenge,
} from "@/lib/client/challenge-validation";
import { ApiError } from "@/server/http";
import { UUID_PATTERN, parseSessionTarget } from "./validation";

function invalid(): never {
  throw new ApiError(
    "STORAGE_UNAVAILABLE",
    "Saved training could not be loaded. Please try again.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function pick(value: unknown, keys: string[]) {
  const input = record(value);
  return Object.fromEntries(
    keys
      .filter((key) => input[key] !== undefined)
      .map((key) => [key, input[key]]),
  );
}
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    invalid();
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}
function sessionMetadata(input: Record<string, unknown>) {
  try {
    const target = parseSessionTarget(input.target);
    if (
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 300
    )
      invalid();
    return { target, title: input.title };
  } catch {
    return invalid();
  }
}
const summaryKeys = ["id", "title", "topic", "order", "mediaStatus"];
function media(value: unknown) {
  const input = record(value);
  return pick(
    input,
    input.kind === "youtube"
      ? ["kind", "videoId", "startSeconds", "endSeconds", "alt", "caption"]
      : input.kind === "uploaded-video"
        ? ["kind", "assetId", "startSeconds", "endSeconds", "alt", "caption"]
        : ["kind", "src", "alt", "caption"],
  );
}
function source(value: unknown) {
  return value === undefined
    ? undefined
    : pick(value, [
        "kind",
        "videoId",
        "assetId",
        "creditUrl",
        "url",
        "title",
        "uploader",
        "player",
        "matchType",
        "map",
        "agent",
        "round",
        "score",
        "side",
        "publishedDate",
        "dateNote",
      ]);
}
export function toChallengePreview(value: unknown): ChallengePreview {
  try {
    const input = record(value);
    return parseChallengePreview({
      ...pick(input, summaryKeys),
      context: input.context,
      setup: media(input.setup),
      ...(input.source === undefined ? {} : { source: source(input.source) }),
    });
  } catch {
    return invalid();
  }
}
export function toChallengeDetail(value: unknown): ChallengeDetail {
  try {
    const input = record(value);
    if (!Array.isArray(input.options)) invalid();
    return parseChallengeDetail({
      ...pick(input, [
        ...summaryKeys,
        "contentVersion",
        "context",
        "question",
        "knownFacts",
        "unknowns",
        "linkedScenarioId",
      ]),
      setup: media(input.setup),
      decision: pick(
        input.decision,
        record(input.decision).kind === "image"
          ? ["kind", "imageUrl", "alt"]
          : ["kind", "atSeconds", "alt"],
      ),
      ...(input.source === undefined ? {} : { source: source(input.source) }),
      options: input.options.map((option) => pick(option, ["id", "label"])),
    });
  } catch {
    return invalid();
  }
}
export function toSavedAnswer(
  value: unknown,
  challenge: ChallengeDetail,
): SavedAnswer {
  try {
    const input = record(value),
      result = record(input.result);
    if (!Array.isArray(result.optionFeedback)) invalid();
    const answer = parseAnswerResponse({
      ...pick(result, [
        "challengeId",
        "contentVersion",
        "selectedOptionId",
        "selectedAssessment",
        "recommendedOptionIds",
        "takeaway",
        "outcomeText",
        "matchesPro",
      ]),
      reveal: media(result.reveal),
      optionFeedback: result.optionFeedback.map((feedback) =>
        pick(feedback, [
          "optionId",
          "assessment",
          "explanation",
          "acceptableWhen",
          "risks",
        ]),
      ),
      ...(result.observedAction === undefined
        ? {}
        : {
            observedAction: pick(result.observedAction, [
              "optionId",
              "description",
            ]),
          }),
      ...(result.analysis === undefined
        ? {}
        : {
            analysis: pick(result.analysis, [
              "author",
              "notice",
              "rationale",
              "limitations",
            ]),
          }),
    });
    validateAnswerForChallenge(answer, challenge);
    return {
      id: id(input.id),
      answeredAt: date(input.answeredAt),
      result: answer,
    };
  } catch {
    return invalid();
  }
}
export function toSessionSnapshot(value: unknown): SessionSnapshot {
  const input = record(value);
  const metadata = sessionMetadata(input);
  if (
    !Array.isArray(input.items) ||
    input.items.length === 0 ||
    input.items.length > 100
  )
    invalid();
  const items = input.items.map((value, index) => {
    const item = record(value),
      challenge = toChallengeDetail(item.challenge);
    if (integer(item.position) !== index) invalid();
    return {
      id: id(item.id),
      position: index,
      challenge,
      answer:
        item.answer === null ? null : toSavedAnswer(item.answer, challenge),
    };
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid();
  if (
    metadata.target.kind === "scenario" &&
    (items.length !== 1 || items[0].challenge.id !== metadata.target.scenarioId)
  )
    invalid();
  const phase = input.phase;
  if (phase !== "setup" && phase !== "review" && phase !== "completed")
    invalid();
  if (input.status !== (phase === "completed" ? "completed" : "in_progress"))
    invalid();
  const currentIndex =
    phase === "completed" ? null : integer(input.currentIndex);
  if (
    (phase === "completed" && input.currentIndex !== null) ||
    (currentIndex !== null && currentIndex >= items.length)
  )
    invalid();
  const revision = integer(input.revision);
  if (
    revision !==
    (phase === "completed"
      ? items.length * 2
      : currentIndex! * 2 + (phase === "review" ? 1 : 0))
  )
    invalid();
  for (const item of items) {
    const shouldHaveAnswer =
      phase === "completed" ||
      item.position < currentIndex! ||
      (item.position === currentIndex && phase === "review");
    if (Boolean(item.answer) !== shouldHaveAnswer) invalid();
  }
  const completedAt = phase === "completed" ? date(input.completedAt) : null;
  if (phase !== "completed" && input.completedAt !== null) invalid();
  return {
    id: id(input.id),
    ...metadata,
    status: phase === "completed" ? "completed" : "in_progress",
    phase,
    revision,
    currentIndex,
    createdAt: date(input.createdAt),
    updatedAt: date(input.updatedAt),
    completedAt,
    items,
  };
}
export function toSessionSummary(value: unknown): SessionSummary {
  const input = record(value),
    answeredCount = integer(input.answeredCount),
    totalCount = integer(input.totalCount);
  if (
    totalCount < 1 ||
    answeredCount > totalCount ||
    (input.status !== "in_progress" && input.status !== "completed")
  )
    invalid();
  if (input.status === "completed" && answeredCount !== totalCount) invalid();
  return {
    id: id(input.id),
    ...sessionMetadata(input),
    status: input.status as SessionSummary["status"],
    answeredCount,
    totalCount,
    createdAt: date(input.createdAt),
    updatedAt: date(input.updatedAt),
    completedAt: input.status === "completed" ? date(input.completedAt) : null,
  };
}
export function toMutationResponse(value: unknown): SessionMutationResponse {
  const input = record(value);
  return {
    session: toSessionSnapshot(input.session),
    replayed: boolean(input.replayed),
  };
}
export function toCreateResponse(value: unknown): CreateSessionResponse {
  const input = record(value);
  return { ...toMutationResponse(input), created: boolean(input.created) };
}
export function toHistoryResponse(value: unknown): SessionHistoryResponse {
  const input = record(value);
  if (!Array.isArray(input.sessions)) invalid();
  return {
    sessions: input.sessions.map(toSessionSummary),
    nextCursor: input.nextCursor === null ? null : id(input.nextCursor),
  };
}
