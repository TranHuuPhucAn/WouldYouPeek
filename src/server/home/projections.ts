import "server-only";
import type { HomePlayerCard, HomeScenarioCard } from "@/contracts/home";
import type { LibraryScenarioPreview } from "@/contracts/library";
import type { PlayerGroup } from "@/contracts/player";

/** Home never needs the preview's setup media or source identifiers. */
export function toHomeScenarioCard(
  preview: LibraryScenarioPreview,
): HomeScenarioCard {
  return {
    id: preview.id,
    title: preview.title,
    topic: preview.topic,
    player: { id: preview.player.id, displayName: preview.player.displayName },
    map: preview.source?.map ?? null,
    agent: preview.source?.agent ?? null,
    editorialOrigin: preview.editorialOrigin,
    provenance: preview.provenance,
    publishedAt: preview.publishedAt,
  };
}

export function toHomePlayerCard(group: PlayerGroup): HomePlayerCard {
  return {
    player: { id: group.player.id, displayName: group.player.displayName },
    scenarioCount: group.scenarioCount,
  };
}
