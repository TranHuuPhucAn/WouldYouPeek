import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import vectors from "../fixtures/playlist-content-cases.json";
import {
  createVerifiedCreator,
  publishScenarioFixture,
  rpc,
} from "./helpers/creator-scenarios";
import { saveProfile } from "./helpers/playlists";
import type { PlaylistMutationResponse } from "@/contracts/playlist";
import type { CreatorProfileMutationResponse } from "@/contracts/creator-profile";
describe("playlist JS/SQL parity through real authoring RPCs", () => {
  it("agrees with shared structural, ready-to-review and public-name vectors", async () => {
    const owner = await createVerifiedCreator();
    const scenario = await publishScenarioFixture(owner);
    let profile = await saveProfile(owner);
    for (const test of vectors.cases) {
      const content = {
        ...structuredClone(vectors.validContent),
        items: [
          {
            scenarioId: scenario.id,
            scenarioVersion: scenario.publication.currentVersion!,
          },
        ],
        [test.path]: test.value,
      };
      const created = await rpc<PlaylistMutationResponse>(
        owner.client,
        "create_creator_playlist",
        { p_request_id: randomUUID() },
      );
      const result = await owner.client.rpc("save_creator_playlist", {
        p_playlist_id: created.playlist.id,
        p_request_id: randomUUID(),
        p_expected_revision: 0,
        p_content: content,
      });
      expect(result.error === null, `${test.name}: structural validity`).toBe(
        test.draftValid,
      );
      if (test.draftValid)
        expect(
          (result.data as PlaylistMutationResponse).playlist.readiness
            .canReview,
          `${test.name}: review readiness`,
        ).toBe(test.publishValid);
    }
    for (const test of vectors.names) {
      const result = await owner.client.rpc("save_creator_profile", {
        p_request_id: randomUUID(),
        p_expected_revision: profile.revision,
        p_display_name: test.input,
      });
      expect(result.error === null, test.name).toBe(test.valid);
      if (test.valid) {
        profile = (result.data as CreatorProfileMutationResponse).profile;
        expect(profile.displayName).toBe(test.normalized);
      }
    }
  });
});
