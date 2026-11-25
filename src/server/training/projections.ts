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
import { parsePlaylistSessionMetadata } from "@/lib/client/playlist-validation";
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
    if (target.kind === "playlist")
      return {
        target,
        title: input.title,
        playlist: parsePlaylistSessionMetadata(input.playlist),
      };
    if (input.playlist !== undefined) invalid();
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
  if (
    metadata.target.kind === "playlist" &&
    (items.length > 20 ||
      new Set(items.map((item) => item.challenge.id)).size !== items.length)
  )
    invalid();
  const phase = input.phase;
  if (
    phase !== "setup" &&
    phase !== "review" &&
    phase !== "completed" &&
    phase !== "ended"
  )
    invalid();
  const terminal = phase === "completed" || phase === "ended";
  if (input.status !== (terminal ? phase : "in_progress")) invalid();
  const currentIndex = terminal ? null : integer(input.currentIndex);
  if (
    (terminal && input.currentIndex !== null) ||
    (currentIndex !== null && currentIndex >= items.length)
  )
    invalid();
  const revision = integer(input.revision);
  const answeredCount = items.filter((item) => item.answer !== null).length;
  if (
    phase === "ended"
      ? answeredCount >= items.length ||
        !(
          revision === answeredCount * 2 + 1 ||
          (answeredCount > 0 && revision === answeredCount * 2)
        )
      : revision !==
        (phase === "completed"
          ? items.length * 2
          : currentIndex! * 2 + (phase === "review" ? 1 : 0))
  )
    invalid();
  for (const item of items) {
    const shouldHaveAnswer =
      phase === "completed" ||
      (phase === "ended"
        ? item.position < answeredCount
        : item.position < currentIndex! ||
          (item.position === currentIndex && phase === "review"));
    if (Boolean(item.answer) !== shouldHaveAnswer) invalid();
  }
  const completedAt = phase === "completed" ? date(input.completedAt) : null;
  if (phase !== "completed" && input.completedAt !== null) invalid();
  const endedAt = phase === "ended" ? date(input.endedAt) : null;
  if (phase !== "ended" && input.endedAt !== null) invalid();
  const createdAt = date(input.createdAt),
    updatedAt = date(input.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) invalid();
  if (
    endedAt !== null &&
    (Date.parse(endedAt) !== Date.parse(updatedAt) ||
      items.some(
        (item) =>
          item.answer !== null &&
          (Date.parse(item.answer.answeredAt) < Date.parse(createdAt) ||
            Date.parse(item.answer.answeredAt) > Date.parse(endedAt)),
      ))
  )
    invalid();
  return {
    id: id(input.id),
    ...metadata,
    status: terminal ? phase : "in_progress",
    phase,
    revision,
    currentIndex,
    createdAt,
    updatedAt,
    completedAt,
    endedAt,
    items,
  };
}
export function toSessionSummary(value: unknown): SessionSummary {
  const input = record(value),
    answeredCount = integer(input.answeredCount),
    totalCount = integer(input.totalCount);
  if (
    totalCount < 1 ||
    totalCount > 100 ||
    answeredCount > totalCount ||
    (input.status !== "in_progress" &&
      input.status !== "completed" &&
      input.status !== "ended")
  )
    invalid();
  if (input.status === "completed" && answeredCount !== totalCount) invalid();
  if (input.status === "ended" && answeredCount >= totalCount) invalid();
  const metadata = sessionMetadata(input);
  if (metadata.target.kind === "playlist" && totalCount > 20) invalid();
  if (metadata.target.kind === "scenario" && totalCount !== 1) invalid();
  const createdAt = date(input.createdAt),
    updatedAt = date(input.updatedAt);
  const completedAt =
    input.status === "completed" ? date(input.completedAt) : null;
  const endedAt = input.status === "ended" ? date(input.endedAt) : null;
  if (
    (input.status !== "completed" && input.completedAt !== null) ||
    (input.status !== "ended" && input.endedAt !== null) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    (endedAt !== null && Date.parse(endedAt) !== Date.parse(updatedAt))
  )
    invalid();
  return {
    id: id(input.id),
    ...metadata,
    status: input.status as SessionSummary["status"],
    answeredCount,
    totalCount,
    createdAt,
    updatedAt,
    completedAt,
    endedAt,
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
