import "server-only";
import { requireVerifiedUser } from "@/server/auth/guards";
import * as repository from "./repository";
import {
  parseStartSession,
  parseAnswerCommand,
  parseAdvanceCommand,
  parseHistoryCursor,
  parseUuid,
} from "./validation";
import {
  toCreateResponse,
  toSessionSnapshot,
  toHistoryResponse,
  toMutationResponse,
} from "./projections";
export async function startSession(input: unknown) {
  await requireVerifiedUser();
  const command = parseStartSession(input);
  return toCreateResponse(
    await repository.startOrResumeSession(command.requestId),
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
