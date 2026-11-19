import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@/contracts/session";
import { createLocalTestClient } from "./helpers/local-supabase";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
  type TestUser,
} from "./helpers/test-users";

describe("real transactional training sessions", () => {
  const users: TestUser[] = [];
  let user: TestUser;
  let session: SessionSnapshot;
  let startRequest: string;
  beforeAll(async () => {
    user = await createVerifiedTestUser();
    users.push(user);
  });
  afterAll(async () => cleanupTestUsers(users));

  async function answer(snapshot: SessionSnapshot, requestId = randomUUID()) {
    const item = snapshot.items[snapshot.currentIndex!];
    return user.client.rpc("submit_session_answer", {
      p_session_id: snapshot.id,
      p_item_id: item.id,
      p_option_id: item.challenge.options[0].id,
      p_request_id: requestId,
      p_expected_revision: snapshot.revision,
    });
  }
  async function advance(snapshot: SessionSnapshot, requestId = randomUUID()) {
    return user.client.rpc("advance_training_session", {
      p_session_id: snapshot.id,
      p_from_item_id: snapshot.items[snapshot.currentIndex!].id,
      p_request_id: requestId,
      p_expected_revision: snapshot.revision,
    });
  }
  async function complete(snapshot: SessionSnapshot) {
    let current = snapshot;
    while (current.phase !== "completed") {
      const result =
        current.phase === "setup"
          ? await answer(current)
          : await advance(current);
      expect(result.error).toBeNull();
      current = result.data.session;
    }
    return current;
  }

  it("serializes concurrent starts into one active frozen session", async () => {
    startRequest = randomUUID();
    const results = await Promise.all([
      user.client.rpc("start_training_session", { p_request_id: startRequest }),
      user.client.rpc("start_training_session", { p_request_id: randomUUID() }),
    ]);
    for (const result of results) expect(result.error).toBeNull();
    expect(results.filter((result) => result.data.created)).toHaveLength(1);
    expect(results[0].data.session.id).toBe(results[1].data.session.id);
    session = results[0].data.session;
    expect(session.revision).toBe(0);
    expect(session.items.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(
      session.items.every(
        (item) =>
          item.challenge.contentVersion === "vod-1" && item.answer === null,
      ),
    ).toBe(true);
  });

  it("rolls back invalid answers and saves concurrent duplicate submissions once", async () => {
    const request = randomUUID();
    const invalid = await user.client.rpc("submit_session_answer", {
      p_session_id: session.id,
      p_item_id: session.items[0].id,
      p_option_id: "forged",
      p_request_id: request,
      p_expected_revision: 0,
    });
    expect(invalid.error?.message).toBe("INVALID_OPTION");
    expect((await user.client.from("attempts").select("id")).data).toEqual([]);
    expect(
      (
        await user.client.rpc("get_training_session", {
          p_session_id: session.id,
        })
      ).data.revision,
    ).toBe(0);
    const before = session;
    const [first, second] = await Promise.all([
      answer(before, request),
      answer(before, request),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect([first.data.replayed, second.data.replayed].sort()).toEqual([
      false,
      true,
    ]);
    session = first.data.session;
    expect(session.phase).toBe("review");
    expect(session.revision).toBe(1);
    expect((await user.client.from("attempts").select("id")).data).toHaveLength(
      1,
    );
    const changed = await user.client.rpc("submit_session_answer", {
      p_session_id: session.id,
      p_item_id: session.items[0].id,
      p_option_id: session.items[0].challenge.options[1].id,
      p_request_id: request,
      p_expected_revision: 0,
    });
    expect(changed.error?.message).toBe("IDEMPOTENCY_CONFLICT");
    expect((await answer(before)).error?.message).toBe("SESSION_CONFLICT");
    expect((await answer(session)).error?.message).toBe("ANSWER_LOCKED");
  });

  it("survives a new login and keeps review until explicit advancement", async () => {
    await user.client.auth.signOut({ scope: "local" });
    const freshClient = createLocalTestClient();
    expect(
      (
        await freshClient.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        })
      ).error,
    ).toBeNull();
    user.client = freshClient;
    const restored = await user.client.rpc("get_training_session", {
      p_session_id: session.id,
    });
    expect(restored.error).toBeNull();
    expect(restored.data).toEqual(session);
    const request = randomUUID();
    const first = await advance(session, request);
    const second = await advance(session, request);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data.replayed).toBe(true);
    expect(second.data.session.currentIndex).toBe(1);
    session = first.data.session;
    const oldStart = await user.client.rpc("start_training_session", {
      p_request_id: startRequest,
    });
    expect(oldStart.data.replayed).toBe(true);
    expect(oldStart.data.session.revision).toBe(2);
  });

  it("rejects competing new answers without partial writes", async () => {
    const before = session;
    const results = await Promise.all([answer(before), answer(before)]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.message).toBe(
      "SESSION_CONFLICT",
    );
    session = results.find((result) => !result.error)!.data.session;
    expect(session.revision).toBe(3);
    expect((await user.client.from("attempts").select("id")).data).toHaveLength(
      2,
    );
  });

  it("retains final review, explicitly finishes, and pins historical feedback", async () => {
    const next = await advance(session);
    expect(next.error).toBeNull();
    session = next.data.session;
    const lastAnswer = await answer(session);
    expect(lastAnswer.error).toBeNull();
    session = lastAnswer.data.session;
    expect(session.phase).toBe("review");
    expect(session.currentIndex).toBe(2);
    expect(session.revision).toBe(5);
    const restored = await user.client.rpc("get_training_session", {
      p_session_id: session.id,
    });
    expect(restored.data.phase).toBe("review");
    expect(restored.data.completedAt).toBeNull();
    const frozenAnswers = session.items.map((item) => item.answer);
    const finish = await advance(session);
    expect(finish.error).toBeNull();
    session = finish.data.session;
    expect(session.phase).toBe("completed");
    expect(session.currentIndex).toBeNull();
    expect(session.revision).toBe(6);
    expect(session.items.map((item) => item.answer)).toEqual(frozenAnswers);
    const replayStart = await user.client.rpc("start_training_session", {
      p_request_id: startRequest,
    });
    expect(replayStart.data.session.id).toBe(session.id);
    expect(replayStart.data.session.phase).toBe("completed");
    const newStart = await user.client.rpc("start_training_session", {
      p_request_id: randomUUID(),
    });
    expect(newStart.error).toBeNull();
    expect(newStart.data.created).toBe(true);
    expect(newStart.data.session.id).not.toBe(session.id);
    expect(
      (
        await user.client.rpc("get_training_session", {
          p_session_id: session.id,
        })
      ).data.items.map((item: SessionSnapshot["items"][number]) => item.answer),
    ).toEqual(frozenAnswers);
    await complete(newStart.data.session);
  });

  it("paginates only own history and rejects invented cursors", async () => {
    const first = await user.client.rpc("list_training_sessions", {
      p_cursor: null,
      p_limit: 1,
    });
    expect(first.error).toBeNull();
    expect(first.data.sessions).toHaveLength(1);
    expect(first.data.nextCursor).not.toBeNull();
    const second = await user.client.rpc("list_training_sessions", {
      p_cursor: first.data.nextCursor,
      p_limit: 1,
    });
    expect(second.error).toBeNull();
    expect(second.data.sessions).toHaveLength(1);
    expect(second.data.nextCursor).toBeNull();
    expect(first.data.sessions[0].id).not.toBe(second.data.sessions[0].id);
    for (const entry of [...first.data.sessions, ...second.data.sessions]) {
      expect(entry.answeredCount).toBe(3);
      expect(entry.totalCount).toBe(3);
      expect(entry.status).toBe("completed");
      expect(entry).not.toHaveProperty("accuracy");
      expect(entry).not.toHaveProperty("rank");
    }
    expect(
      (
        await user.client.rpc("list_training_sessions", {
          p_cursor: "invented",
          p_limit: 1,
        })
      ).error?.message,
    ).toBe("INVALID_REQUEST");
  });
});
