import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { TestUser } from "./helpers/test-users";
import { createVerifiedTestUser } from "./helpers/test-users";
import { createLocalTestClient } from "./helpers/local-supabase";
import {
  createVerifiedCreator,
  createDraftFixture,
  publishScenarioFixture,
  rpc,
  checklist,
} from "./helpers/creator-scenarios";
import type {
  CreatorScenarioSnapshot,
  CreatorListResponse,
} from "@/contracts/creator";
import type {
  LibraryListResponse,
  LibraryScenarioPreview,
} from "@/contracts/library";

describe("creator ownership through actual Auth and Data API", () => {
  let owner: TestUser,
    other: TestUser,
    learner: TestUser,
    draft: CreatorScenarioSnapshot,
    published: CreatorScenarioSnapshot;
  beforeAll(async () => {
    owner = await createVerifiedCreator();
    other = await createVerifiedCreator();
    learner = await createVerifiedTestUser();
    draft = await createDraftFixture(owner);
    published = await publishScenarioFixture(owner);
  });
  // The explicitly disposable project is the cleanup boundary for immutable publications.
  it("denies guests and learners all authoring entry points", async () => {
    const anonymous = createLocalTestClient();
    expect(
      (
        await anonymous.rpc("create_creator_scenario", {
          p_request_id: randomUUID(),
        })
      ).error,
    ).not.toBeNull();
    expect((await anonymous.rpc("list_library_previews")).error).toBeNull();
    expect(
      (
        await learner.client.rpc("create_creator_scenario", {
          p_request_id: randomUUID(),
        })
      ).error?.message,
    ).toBe("CREATOR_REQUIRED");
    expect(
      (
        await learner.client.rpc("get_creator_scenario", {
          p_scenario_id: draft.id,
        })
      ).error?.message,
    ).toBe("CREATOR_REQUIRED");
  });
  it("makes foreign drafts indistinguishable from missing records", async () => {
    const commands: [string, Record<string, unknown>][] = [
      ["get_creator_scenario", { p_scenario_id: draft.id }],
      [
        "save_creator_scenario",
        {
          p_scenario_id: draft.id,
          p_content: draft.draft.content,
          p_request_id: randomUUID(),
          p_expected_revision: draft.revision,
        },
      ],
      [
        "get_creator_review_preview",
        { p_scenario_id: draft.id, p_revision: draft.revision },
      ],
      [
        "review_creator_scenario",
        {
          p_scenario_id: draft.id,
          p_checklist: checklist(),
          p_request_id: randomUUID(),
          p_expected_revision: draft.revision,
        },
      ],
      [
        "publish_creator_scenario",
        {
          p_scenario_id: published.id,
          p_review_id: published.review!.id,
          p_request_id: randomUUID(),
          p_expected_revision: published.revision,
        },
      ],
      [
        "unpublish_creator_scenario",
        {
          p_scenario_id: published.id,
          p_request_id: randomUUID(),
          p_expected_revision: published.revision,
        },
      ],
    ];
    for (const [name, args] of commands)
      expect((await other.client.rpc(name, args)).error?.message, name).toBe(
        "SCENARIO_NOT_FOUND",
      );
    expect(
      (
        await other.client.rpc("get_creator_scenario", {
          p_scenario_id: randomUUID(),
        })
      ).error?.message,
    ).toBe("SCENARIO_NOT_FOUND");
    const mine = await rpc<CreatorListResponse>(
      other.client,
      "list_creator_scenarios",
    );
    expect(mine.scenarios).toHaveLength(0);
  });
  it("discloses only published setup and standalone provenance to learners", async () => {
    expect(
      (
        await learner.client.rpc("get_library_preview", {
          p_scenario_id: draft.id,
        })
      ).data,
    ).toBeNull();
    const preview = await rpc<LibraryScenarioPreview>(
      learner.client,
      "get_library_preview",
      { p_scenario_id: published.id },
    );
    expect(preview.id).toBe(published.id);
    expect(preview.provenance).toBe("creator");
    for (const key of [
      "options",
      "question",
      "decision",
      "reveal",
      "analysis",
      "observedAction",
      "review",
      "creator_id",
      "email",
    ])
      expect(preview).not.toHaveProperty(key);
    const list = await rpc<LibraryListResponse>(
      learner.client,
      "list_library_previews",
    );
    expect(list.scenarios.some((s) => s.id === published.id)).toBe(true);
    expect(list.scenarios.some((s) => s.id === draft.id)).toBe(false);
  });
  it("blocks direct table writes and system demo claims", async () => {
    expect(
      (
        await owner.client
          .from("scenarios")
          .update({ is_published: false })
          .eq("id", published.id)
      ).error,
    ).not.toBeNull();
    expect(
      (await owner.client.from("scenario_versions").select("*")).error,
    ).not.toBeNull();
    expect(
      (await owner.client.schema("private").from("scenario_drafts").select("*"))
        .error,
    ).not.toBeNull();
    expect(
      (
        await owner.client.rpc("get_creator_scenario", {
          p_scenario_id: "bind-clove-utility-window",
        })
      ).error?.message,
    ).toBe("SCENARIO_NOT_FOUND");
    expect(
      (
        await owner.client.rpc("create_creator_scenario", {
          p_request_id: randomUUID(),
          p_owner_id: other.id,
        })
      ).error,
    ).not.toBeNull();
  });
  it("rechecks current verification and creator role for an existing JWT", async () => {
    const revoked = await createVerifiedCreator();
    const own = await createDraftFixture(revoked);
    const admin = createLocalTestClient("admin");
    const update = await admin
      .from("profiles")
      .update({ role: "learner", creator_enabled_at: null })
      .eq("user_id", revoked.id);
    expect(update.error).toBeNull();
    expect(
      (
        await revoked.client.rpc("get_creator_scenario", {
          p_scenario_id: own.id,
        })
      ).error?.message,
    ).toBe("CREATOR_REQUIRED");
    const restore = await admin
      .from("profiles")
      .update({
        role: "creator",
        creator_enabled_at: new Date().toISOString(),
        email_verified_at: null,
      })
      .eq("user_id", revoked.id);
    expect(restore.error).toBeNull();
    expect(
      (
        await revoked.client.rpc("get_creator_scenario", {
          p_scenario_id: own.id,
        })
      ).error?.message,
    ).toBe("EMAIL_NOT_VERIFIED");
  });
});
