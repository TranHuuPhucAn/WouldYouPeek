import { readApiResponse } from "./api-response";
import {
  invalidResponse,
  isRecord,
  parseChallengePreview,
} from "./challenge-validation";
export { ApiClientError as ChallengeApiError } from "./api-response";
export { validateAnswerForChallenge } from "./challenge-validation";

export async function getChallenges(signal?: AbortSignal) {
  const body = await readApiResponse(
    await fetch("/api/challenges", { signal, cache: "no-store" }),
  );
  if (!isRecord(body) || !Array.isArray(body.challenges)) invalidResponse();
  const previews = body.challenges.map(parseChallengePreview);
  if (new Set(previews.map((item) => item.id)).size !== previews.length)
    invalidResponse();
  return previews;
}
export async function getChallengePreview(id: string, signal?: AbortSignal) {
  const body = parseChallengePreview(
    await readApiResponse(
      await fetch(`/api/challenges/${encodeURIComponent(id)}`, {
        signal,
        cache: "no-store",
      }),
    ),
  );
  if (body.id !== id) invalidResponse();
  return body;
}
