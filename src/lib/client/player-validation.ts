import type { PlayerSummary } from "@/contracts/player";
import { PLAYER_DISPLAY_MAX_CODE_POINTS } from "@/lib/players/identity";
import { invalidResponse, isRecord } from "./challenge-validation";

export function parsePlayerSummary(value: unknown): PlayerSummary {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.id,
    ) ||
    typeof value.displayName !== "string" ||
    !value.displayName.trim() ||
    [...value.displayName].length > PLAYER_DISPLAY_MAX_CODE_POINTS ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value.displayName)
  )
    invalidResponse();
  return { id: value.id, displayName: value.displayName };
}
