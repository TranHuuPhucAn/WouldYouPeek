import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@/contracts/session";
import { createLocalTestClient } from "./helpers/local-supabase";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
  type TestUser,
} from "./helpers/test-users";

describe("real Data API access boundaries", () => {
  const users: TestUser[] = [];
  let learner: TestUser;
  let other: TestUser;
  let session: SessionSnapshot;
  beforeAll(async () => {
    learner = await createVerifiedTestUser({ role: "creator" });
    users.push(learner);
    other = await createVerifiedTestUser();
    users.push(other);
    const start = await learner.client.rpc("start_training_session", {
      p_request_id: randomUUID(),
    });
    expect(start.error).toBeNull();
    session = start.data.session as SessionSnapshot;
  });
  afterAll(async () => cleanupTestUsers(users));

  it("allows only setup previews to guests, including direct RPC access", async () => {
    const guest = createLocalTestClient();
    const previews = await guest.rpc("list_scenario_previews");
    expect(previews.error).toBeNull();
    expect(previews.data).toHaveLength(3);
    for (const preview of previews.data) {
      expect(Object.keys(preview).sort()).toEqual([
        "context",
        "id",
        "mediaStatus",
        "order",
        "setup",
        "source",
        "title",
        "topic",
      ]);
    }
    for (const table of [
      "scenario_versions",
      "training_sessions",
      "training_session_items",
      "attempts",
      "profiles",
    ]) {
      expect((await guest.from(table).select("*")).error).not.toBeNull();
    }
    expect(
      (await guest.schema("private").from("scenario_answer_keys").select("*"))
        .error,
    ).not.toBeNull();
    expect(
      (
        await guest.rpc("start_training_session", {
          p_request_id: randomUUID(),
        })
      ).error,
    ).not.toBeNull();
    expect(
      (await guest.rpc("get_training_session", { p_session_id: session.id }))
        .error,
    ).not.toBeNull();
  });

  it("rejects a forged caller JWT before reaching protected RPCs", async () => {
    const guest = createLocalTestClient();
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const forged = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: learner.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
    const result = await guest
      .rpc("get_training_session", { p_session_id: session.id })
      .setHeader("Authorization", `Bearer ${forged}`);
    expect(result.error).not.toBeNull();
    expect(result.data).toBeNull();
  });

  it("ignores signup metadata roles and only enables the caller", async () => {
    const profile = await learner.client
      .from("profiles")
      .select("role")
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data?.role).toBe("learner");
    expect(
      (
        await learner.client
          .from("profiles")
          .update({
            role: "creator",
            creator_enabled_at: new Date().toISOString(),
          })
          .eq("user_id", learner.id)
      ).error,
    ).not.toBeNull();
    expect(
      (await learner.client.rpc("enable_creator", { p_user_id: other.id }))
        .error,
    ).not.toBeNull();
    const first = await learner.client.rpc("enable_creator");
    const second = await learner.client.rpc("enable_creator");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(first.data.role).toBe("creator");
    expect(second.data.creatorEnabledAt).toBe(first.data.creatorEnabledAt);
    expect(
      (await other.client.from("profiles").select("role").single()).data?.role,
    ).toBe("learner");
  });

  it("hides foreign sessions, items, attempts and profiles even from creators", async () => {
    await other.client.rpc("enable_creator");
    for (const table of [
      "training_sessions",
      "training_session_items",
      "attempts",
      "profiles",
    ]) {
      const result = await other.client
        .from(table)
        .select("*")
        .eq("user_id", learner.id);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    const foreign = await other.client.rpc("get_training_session", {
      p_session_id: session.id,
    });
    const missing = await other.client.rpc("get_training_session", {
      p_session_id: randomUUID(),
    });
    expect(foreign.error?.message).toBe("SESSION_NOT_FOUND");
    expect(missing.error?.message).toBe(foreign.error?.message);
    const answer = await other.client.rpc("submit_session_answer", {
      p_session_id: session.id,
      p_item_id: session.items[0].id,
      p_option_id: session.items[0].challenge.options[0].id,
      p_request_id: randomUUID(),
      p_expected_revision: 0,
    });
    expect(answer.error?.message).toBe("SESSION_NOT_FOUND");
    expect(
      (
        await other.client.rpc("list_training_sessions", {
          p_cursor: session.id,
          p_limit: 20,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
  });

  it("denies forged progress, attempt insertion/deletion, private helpers and answer keys", async () => {
    expect(
      (
        await learner.client
          .from("training_sessions")
          .update({ phase: "completed", revision: 99 })
          .eq("id", session.id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await learner.client
          .from("training_session_items")
          .update({ position: 9 })
          .eq("id", session.items[0].id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await learner.client
          .from("attempts")
          .insert({
            item_id: session.items[0].id,
            session_id: session.id,
            user_id: learner.id,
            option_id: "forged",
            answer: { selectedAssessment: "recommended" },
          })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await learner.client
          .from("attempts")
          .delete()
          .eq("session_id", session.id)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await learner.client
          .schema("private")
          .from("scenario_answer_keys")
          .select("*")
      ).error,
    ).not.toBeNull();
    expect(
      (
        await learner.client
          .schema("private")
          .rpc("read_session_snapshot", { p_session_id: session.id })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await learner.client.rpc("get_training_session", {
          p_session_id: session.id,
        })
      ).data.revision,
    ).toBe(0);
  });
});
