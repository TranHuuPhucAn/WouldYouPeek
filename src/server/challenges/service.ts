import "server-only";
import { ApiError } from "@/server/http";
import { listPreviewRecords, findPreviewRecord } from "./repository";
import { toChallengePreview } from "@/server/training/projections";
export async function listChallengePreviews() {
  const records = await listPreviewRecords();
  if (!Array.isArray(records))
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "The demo catalogue could not be loaded.",
    );
  return records.map(toChallengePreview).sort((a, b) => a.order - b.order);
}
export async function getChallengePreview(id: string) {
  if (!/^[a-z0-9-]{1,100}$/.test(id))
    throw new ApiError(
      "CHALLENGE_NOT_FOUND",
      "This challenge could not be found.",
    );
  const record = await findPreviewRecord(id);
  if (!record)
    throw new ApiError(
      "CHALLENGE_NOT_FOUND",
      "This challenge could not be found.",
    );
  return toChallengePreview(record);
}
