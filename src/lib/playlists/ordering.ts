import type {
  PlaylistSelection,
  PlaylistItemPreview,
} from "@/contracts/playlist";

export function addPlaylistItem(
  items: PlaylistSelection[],
  candidate: PlaylistItemPreview,
): PlaylistSelection[] {
  if (
    items.length >= 20 ||
    items.some((item) => item.scenarioId === candidate.scenarioId)
  )
    return items;
  return [
    ...items,
    {
      scenarioId: candidate.scenarioId,
      scenarioVersion: candidate.scenarioVersion,
    },
  ];
}
export function removePlaylistItem(
  items: PlaylistSelection[],
  scenarioId: string,
): PlaylistSelection[] {
  return items.filter((item) => item.scenarioId !== scenarioId);
}
export function movePlaylistItem(
  items: PlaylistSelection[],
  scenarioId: string,
  direction: -1 | 1,
): PlaylistSelection[] {
  const index = items.findIndex((item) => item.scenarioId === scenarioId),
    next = index + direction;
  if (index < 0 || next < 0 || next >= items.length) return items;
  const result = [...items];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}
export function replacePlaylistItemVersion(
  items: PlaylistSelection[],
  scenarioId: string,
  candidate: PlaylistItemPreview,
): PlaylistSelection[] {
  if (candidate.scenarioId !== scenarioId) return items;
  return items.map((item) =>
    item.scenarioId === scenarioId
      ? { scenarioId, scenarioVersion: candidate.scenarioVersion }
      : item,
  );
}
