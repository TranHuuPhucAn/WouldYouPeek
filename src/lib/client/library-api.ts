import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";
import { readApiResponse } from "./api-response";
import {
  invalidResponse,
  isRecord,
  parseChallengePreview,
} from "./challenge-validation";
import { isDate, isUuid } from "./session-api";
import type { PlayerGroup, PlayerListResponse } from "@/contracts/player";
import { isScenarioId } from "@/lib/scenario-id";
import { parsePlayerSummary } from "./player-validation";
export function parseLibraryEntry(
  value: unknown,
  expectedId?: string,
): LibraryScenarioPreview {
  if (
    !isRecord(value) ||
    !isScenarioId(value.id) ||
    (expectedId && value.id !== expectedId) ||
    typeof value.contentVersion !== "string" ||
    !value.contentVersion.trim() ||
    value.contentVersion.length > 100 ||
    !["ai", "creator", "ai-assisted"].includes(String(value.provenance)) ||
    !["curated", "creator"].includes(String(value.editorialOrigin)) ||
    (value.publishedAt !== null && !isDate(value.publishedAt))
  )
    invalidResponse();
  const {
    provenance,
    publishedAt,
    editorialOrigin,
    player,
    contentVersion,
    ...preview
  } = value;
  return {
    ...parseChallengePreview(preview),
    contentVersion,
    provenance: provenance as LibraryScenarioPreview["provenance"],
    editorialOrigin:
      editorialOrigin as LibraryScenarioPreview["editorialOrigin"],
    player: parsePlayerSummary(player),
    publishedAt,
  };
}
export function parseLibraryPage(value: unknown): LibraryListResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["scenarios", "nextCursor"].includes(key),
    ) ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length > 50 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        value.nextCursor.length > 0 &&
        value.nextCursor.length <= 1024)
    )
  )
    invalidResponse();
  const scenarios = value.scenarios.map((item) => parseLibraryEntry(item));
  if (new Set(scenarios.map((item) => item.id)).size !== scenarios.length)
    invalidResponse();
  return { scenarios, nextCursor: value.nextCursor };
}
export async function listLibraryScenarios(
  {
    cursor = null,
    playerId,
  }: { cursor?: string | null; playerId?: string } = {},
  signal?: AbortSignal,
) {
  if (playerId !== undefined && !isUuid(playerId)) invalidResponse();
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (playerId) query.set("playerId", playerId);
  return parseLibraryPage(
    await readApiResponse(
      await fetch(`/api/library/scenarios${query.size ? `?${query}` : ""}`, {
        cache: "no-store",
        signal,
      }),
    ),
  );
}

export function parsePlayerGroup(value: unknown): PlayerGroup {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["player", "scenarioCount", "scenarios"].includes(key),
    ) ||
    !Number.isSafeInteger(value.scenarioCount) ||
    Number(value.scenarioCount) < 1 ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.length < 1 ||
    value.scenarios.length > 3 ||
    value.scenarios.length > Number(value.scenarioCount)
  )
    invalidResponse();
  const player = parsePlayerSummary(value.player);
  const scenarios = value.scenarios.map((item) => parseLibraryEntry(item));
  if (
    scenarios.some((item) => item.player.id !== player.id) ||
    new Set(scenarios.map((item) => item.id)).size !== scenarios.length
  )
    invalidResponse();
  return { player, scenarios, scenarioCount: value.scenarioCount as number };
}

export function parsePlayerListResponse(value: unknown): PlayerListResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !["players", "nextCursor"].includes(key),
    ) ||
    !Array.isArray(value.players) ||
    value.players.length > 12 ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        value.nextCursor.length > 0 &&
        value.nextCursor.length <= 1024)
    )
  )
    invalidResponse();
  const players = value.players.map(parsePlayerGroup);
  if (new Set(players.map((group) => group.player.id)).size !== players.length)
    invalidResponse();
  return { players, nextCursor: value.nextCursor };
}

export async function listLibraryPlayers(
  {
    query = "",
    cursor = null,
  }: { query?: string; cursor?: string | null } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  return parsePlayerListResponse(
    await readApiResponse(
      await fetch(`/api/library/players${params.size ? `?${params}` : ""}`, {
        cache: "no-store",
        signal,
      }),
    ),
  );
}
export async function getLibraryScenario(id: string, signal?: AbortSignal) {
  return parseLibraryEntry(
    await readApiResponse(
      await fetch(`/api/library/scenarios/${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal,
      }),
    ),
    id,
  );
}
