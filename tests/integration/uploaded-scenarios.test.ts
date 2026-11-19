import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreatorMutationResponse } from "@/contracts/creator";
import type { SessionMutationResponse } from "@/contracts/session";
import type { TestUser } from "./helpers/test-users";
import { cleanupTestUsers, createVerifiedTestUser } from "./helpers/test-users";
import { createLocalTestClient } from "./helpers/local-supabase";
import {
  createDraftFixture,
  createVerifiedCreator,
  publishScenarioFixture,
  race,
  reviewDraftFixture,
  rpc,
  saveDraftFixture,
  startSingle,
  validContent,
} from "./helpers/creator-scenarios";
import {
  fixture,
  objectPath,
  reserve,
  uploadedContent,
  uploadReady,
} from "./helpers/videos";
let owner: TestUser, other: TestUser, learner: TestUser;
const paths: string[] = [];
beforeAll(async () => {
  owner = await createVerifiedCreator();
  other = await createVerifiedCreator();
  learner = await createVerifiedTestUser();
});
afterAll(async () => {
  if (paths.length)
    await createLocalTestClient("admin")
      .storage.from("creator-vods")
      .remove(paths);
  await cleanupTestUsers([owner, other, learner].filter(Boolean));
});
describe("uploaded authoring, publication and pinned learner sessions", () => {
  it("requires a ready owned source and trusted duration before saving a scenario", async () => {
    const bytes = await fixture("silent.mp4"),
      pending = (await reserve(owner, bytes)).video;
    const draft = await createDraftFixture(owner, validContent());
    async function save(content: unknown) {
      return owner.client.rpc("save_creator_scenario", {
        p_scenario_id: draft.id,
        p_request_id: randomUUID(),
        p_expected_revision: draft.revision,
        p_content: content,
      });
    }
    expect((await save(uploadedContent(pending.id))).error?.message).toBe(
      "VIDEO_NOT_READY",
    );
    const foreign = await uploadReady(other, bytes);
    paths.push(objectPath(other, foreign.id));
    expect((await save(uploadedContent(foreign.id))).error?.message).toBe(
      "VIDEO_NOT_FOUND",
    );
    const ready = await uploadReady(owner, bytes);
    paths.push(objectPath(owner, ready.id));
    const tooLong = uploadedContent(ready.id);
    tooLong.media.endSeconds = 16;
    expect((await save(tooLong)).error?.message).toBe("INVALID_REQUEST");
    const saved = await saveDraftFixture(
      owner,
      draft,
      uploadedContent(ready.id),
    );
    expect(
      (
        await owner.client.rpc("begin_creator_video_delete", {
          p_asset_id: ready.id,
          p_request_id: randomUUID(),
          p_expected_revision: ready.revision,
        })
      ).error?.message,
    ).toBe("VIDEO_IN_USE");
    const changed = await saveDraftFixture(owner, saved, validContent());
    expect(changed.draft.content.source.kind).not.toBe("uploaded");
    const canDelete = await rpc<{ canDelete: boolean }>(
      owner.client,
      "get_creator_video",
      { p_asset_id: ready.id },
    );
    expect(canDelete.canDelete).toBe(true);
  });
  it("publishes upload segments, hides reveal before an answer, and preserves old media after replacement and withdrawal", async () => {
    const old = await uploadReady(owner, await fixture());
    paths.push(objectPath(owner, old.id));
    let published = await publishScenarioFixture(
      owner,
      uploadedContent(old.id),
    );
    const shared = await publishScenarioFixture(owner, {
      ...uploadedContent(old.id),
      title: "Another manually selected moment from the same recording",
    });
    expect(shared.id).not.toBe(published.id);
    expect(
      (
        await rpc<{ assetId: string }>(
          learner.client,
          "authorize_video_playback",
          {
            p_context: { kind: "library-scenario", scenarioId: shared.id },
          },
        )
      ).assetId,
    ).toBe(old.id);
    await rpc(owner.client, "unpublish_creator_scenario", {
      p_scenario_id: shared.id,
      p_request_id: randomUUID(),
      p_expected_revision: shared.revision,
    });
    const context = {
      kind: "creator-scenario",
      scenarioId: published.id,
      revision: published.revision,
      phase: "setup",
    };
    expect(
      (
        await rpc<{ assetId: string }>(
          owner.client,
          "authorize_video_playback",
          { p_context: context },
        )
      ).assetId,
    ).toBe(old.id);
    expect(
      (
        await owner.client.rpc("authorize_video_playback", {
          p_context: { ...context, revision: published.revision - 1 },
        })
      ).error?.message,
    ).toBe("SCENARIO_CONFLICT");
    const session = await startSingle(learner, published.id),
      item = session.items[0];
    expect(item.challenge.setup).toMatchObject({
      kind: "uploaded-video",
      assetId: old.id,
      startSeconds: 0,
      endSeconds: 7,
    });
    expect(JSON.stringify(item.challenge)).not.toContain("source.mp4");
    expect(item.answer).toBeNull();
    expect(item.challenge).not.toHaveProperty("answerKey");
    const access = {
      kind: "session-item",
      sessionId: session.id,
      itemId: item.id,
      phase: "setup",
    };
    expect(
      (
        await rpc<{ assetId: string }>(
          learner.client,
          "authorize_video_playback",
          { p_context: access },
        )
      ).assetId,
    ).toBe(old.id);
    expect(
      (
        await learner.client.rpc("authorize_video_playback", {
          p_context: { ...access, phase: "reveal" },
        })
      ).error?.message,
    ).toBe("VIDEO_NOT_FOUND");
    expect(
      (
        await other.client.rpc("authorize_video_playback", {
          p_context: access,
        })
      ).error?.message,
    ).toBe("SESSION_NOT_FOUND");
    const answered = await rpc<SessionMutationResponse>(
      learner.client,
      "submit_session_answer",
      {
        p_session_id: session.id,
        p_item_id: item.id,
        p_option_id: item.challenge.options[0].id,
        p_request_id: randomUUID(),
        p_expected_revision: session.revision,
      },
    );
    expect(answered.session.items[0].answer).not.toBeNull();
    const newer = await uploadReady(owner, await fixture("silent.mp4"));
    paths.push(objectPath(owner, newer.id));
    published = await reviewDraftFixture(
      owner,
      await saveDraftFixture(owner, published, uploadedContent(newer.id)),
    );
    published = (
      await rpc<CreatorMutationResponse>(
        owner.client,
        "publish_creator_scenario",
        {
          p_scenario_id: published.id,
          p_request_id: randomUUID(),
          p_expected_revision: published.revision,
          p_review_id: published.review!.id,
        },
      )
    ).scenario;
    const current = await rpc<{ assetId: string }>(
      learner.client,
      "authorize_video_playback",
      { p_context: { kind: "library-scenario", scenarioId: published.id } },
    );
    expect(current.assetId).toBe(newer.id);
    published = (
      await rpc<CreatorMutationResponse>(
        owner.client,
        "unpublish_creator_scenario",
        {
          p_scenario_id: published.id,
          p_request_id: randomUUID(),
          p_expected_revision: published.revision,
        },
      )
    ).scenario;
    expect(
      (
        await learner.client.rpc("authorize_video_playback", {
          p_context: { kind: "library-scenario", scenarioId: published.id },
        })
      ).error?.message,
    ).toBe("SCENARIO_UNAVAILABLE");
    expect(
      (
        await rpc<{ assetId: string }>(
          learner.client,
          "authorize_video_playback",
          { p_context: { ...access, phase: "reveal" } },
        )
      ).assetId,
    ).toBe(old.id);
    expect(
      (
        await owner.client.rpc("begin_creator_video_delete", {
          p_asset_id: old.id,
          p_request_id: randomUUID(),
          p_expected_revision: old.revision,
        })
      ).error?.message,
    ).toBe("VIDEO_IN_USE");
  });
  it("serializes a source attachment against deletion of the same ready file", async () => {
    const ready = await uploadReady(owner, await fixture("silent.mp4"));
    paths.push(objectPath(owner, ready.id));
    const draft = await createDraftFixture(owner);
    const [saved, removed] = await race(
      () =>
        owner.client.rpc("save_creator_scenario", {
          p_scenario_id: draft.id,
          p_request_id: randomUUID(),
          p_expected_revision: draft.revision,
          p_content: uploadedContent(ready.id),
        }),
      () =>
        owner.client.rpc("begin_creator_video_delete", {
          p_asset_id: ready.id,
          p_request_id: randomUUID(),
          p_expected_revision: ready.revision,
        }),
    );
    expect(
      [saved, removed].filter((result) => result.error === null),
    ).toHaveLength(1);
    if (saved.error === null)
      expect(removed.error?.message).toBe("VIDEO_IN_USE");
    else expect(saved.error.message).toBe("VIDEO_NOT_READY");
  });
});
