import "server-only";
import { ApiError } from "@/server/http";
import { requireVerifiedUser } from "@/server/auth/guards";
import * as repository from "./repository";
import {
  parseStartSession,
  parseAnswerCommand,
  parseAdvanceCommand,
  parseEndCommand,
  parseHistoryCursor,
  parseUuid,
} from "./validation";
import {
  toCreateResponse,
  toSessionSnapshot,
  toSessionSummary,
  toHistoryResponse,
  toMutationResponse,
} from "./projections";
export async function startSession(input: unknown) {
  await requireVerifiedUser();
  const command = parseStartSession(input);
  return toCreateResponse(
    await (command.target
      ? repository.startOrResumeSession(
          command.requestId,
          command.target,
          command.expectedPublicationVersion,
        )
      : repository.startOrResumeSession(command.requestId)),
  );
}
export async function getSession(sessionId: string) {
  await requireVerifiedUser();
  return toSessionSnapshot(await repository.findSession(parseUuid(sessionId)));
}
export async function getHistory(cursor?: string | null) {
  await requireVerifiedUser();
  return toHistoryResponse(
    await repository.listSessions(parseHistoryCursor(cursor)),
  );
}
export async function answerSessionItem(
  sessionId: string,
  itemId: string,
  input: unknown,
) {
  await requireVerifiedUser();
  return toMutationResponse(
    await repository.submitSessionAnswer(
      parseUuid(sessionId),
      parseUuid(itemId),
      parseAnswerCommand(input),
    ),
  );
}
export async function advanceSession(sessionId: string, input: unknown) {
  await requireVerifiedUser();
  return toMutationResponse(
    await repository.advanceSession(
      parseUuid(sessionId),
      parseAdvanceCommand(input),
    ),
  );
}

export async function getActiveSessionSummary() {
  await requireVerifiedUser();
  const data = await repository.findActiveSessionSummary();
  if (data === null) return null;
  const summary = toSessionSummary(data);
  if (summary.status !== "in_progress") {
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Saved training could not be loaded safely.",
    );
  }
  return summary;
}
export async function endSession(sessionId: string, input: unknown) {
  await requireVerifiedUser();
  return toMutationResponse(
    await repository.endSession(parseUuid(sessionId), parseEndCommand(input)),
  );
}
