import { describe, expect, it } from "vitest";
import type { LibraryScenarioPreview } from "@/contracts/library";
import { TENZ_PLAYER_ID } from "@/contracts/player";
import {
  toHomePlayerCard,
  toHomeScenarioCard,
} from "@/server/home/projections";
import { toLibraryPreview } from "@/server/library/projections";
import { snapshot } from "./helpers/session";

function preview(): LibraryScenarioPreview {
  return toLibraryPreview({
    ...snapshot().items[0].challenge,
    player: { id: TENZ_PLAYER_ID, displayName: "TenZ" },
    editorialOrigin: "curated",
    provenance: "ai",
    publishedAt: null,
  });
}

describe("Home metadata projections", () => {
  it("allowlists scenario and nested player fields without media, answers or ownership", () => {
    const original = preview();
    const result = toHomeScenarioCard({
      ...original,
      player: { ...original.player, email: "hidden@example.test" },
      question: "Hidden question",
      options: [{ id: "hidden" }],
      decision: { atSeconds: 10 },
      reveal: { signedUrl: "secret-video" },
      analysis: { rationale: "Hidden analysis" },
      ownerId: "secret-owner",
      storageKey: "private-file",
    } as LibraryScenarioPreview);
    expect(Object.keys(result).sort()).toEqual([
      "agent",
      "editorialOrigin",
      "id",
      "map",
      "player",
      "provenance",
      "publishedAt",
      "title",
      "topic",
    ]);
    expect(result.player).toEqual({ id: TENZ_PLAYER_ID, displayName: "TenZ" });
    expect(result).toMatchObject({
      id: original.id,
      title: original.title,
      map: original.source?.map,
      agent: original.source?.agent,
      editorialOrigin: "curated",
      provenance: "ai",
      publishedAt: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/hidden|secret|private-file/i);
    expect(result.player).not.toBe(original.player);
  });

  it("preserves useful uploaded-source metadata while excluding the asset identifier", () => {
    const original = preview();
    const result = toHomeScenarioCard({
      ...original,
      source: {
        kind: "uploaded",
        assetId: "private-asset",
        creditUrl: "https://example.test/credit",
        title: "A source recording",
        uploader: "Creator",
        player: "TenZ",
        matchType: "ranked",
        map: "Haven",
        agent: "Jett",
        round: 4,
        score: "2-1",
        side: "attack",
      },
      editorialOrigin: "creator",
      provenance: "ai-assisted",
      publishedAt: "2026-11-21T00:00:00Z",
    });
    expect(result).toMatchObject({
      map: "Haven",
      agent: "Jett",
      provenance: "ai-assisted",
      editorialOrigin: "creator",
      publishedAt: "2026-11-21T00:00:00Z",
    });
    expect(JSON.stringify(result)).not.toContain("private-asset");
    expect(JSON.stringify(result)).not.toContain("creditUrl");
  });

  it("represents missing optional source metadata without invented map or agent", () => {
    const { source: omitted, ...withoutSource } = preview();
    void omitted;
    expect(toHomeScenarioCard(withoutSource)).toMatchObject({
      map: null,
      agent: null,
    });
  });

  it("keeps the exact full player count while dropping sampled scenarios and extra fields", () => {
    const original = preview();
    const result = toHomePlayerCard({
      player: { ...original.player, email: "hidden@example.test" },
      scenarioCount: 37,
      scenarios: [original],
      ownerId: "hidden-owner",
    } as Parameters<typeof toHomePlayerCard>[0]);
    expect(result).toEqual({
      player: { id: TENZ_PLAYER_ID, displayName: "TenZ" },
      scenarioCount: 37,
    });
  });
});
