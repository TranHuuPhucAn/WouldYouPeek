import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type {
  CreateSessionResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import {
  createVerifiedTestUser,
  cleanupTestUsers,
  type TestUser,
} from "./helpers/test-users";
import { independentClient, rpc } from "./helpers/creator-scenarios";
import { raceBehindLock } from "./helpers/playlists";

const users: TestUser[] = [];
async function learner() {
  const user = await createVerifiedTestUser();
  users.push(user);
  return user;
}
async function start(user: TestUser) {
  return (
    await rpc<CreateSessionResponse>(user.client, "start_training_session", {
      p_request_id: randomUUID(),
    })
  ).session;
}
function endArgs(s: SessionSnapshot, requestId = randomUUID()) {
  return {
    p_session_id: s.id,
    p_request_id: requestId,
    p_expected_revision: s.revision,
  };
}
function answerArgs(s: SessionSnapshot) {
  const item = s.items[s.currentIndex!];
  return {
    p_session_id: s.id,
    p_item_id: item.id,
    p_option_id: item.challenge.options[0].id,
    p_request_id: randomUUID(),
    p_expected_revision: s.revision,
  };
}
async function read(user: TestUser, id: string) {
  return rpc<SessionSnapshot>(user.client, "get_training_session", {
    p_session_id: id,
  });
}
afterAll(async () => cleanupTestUsers(users));

describe("persisted early session endings", () => {
  it("closes a zero-answer run exactly once across two clients and releases its slot", async () => {
    const user = await learner(),
      client = await independentClient(user),
      s = await start(user),
      command = endArgs(s);
    const results = await Promise.all([
      user.client.rpc("end_training_session", command),
      client.rpc("end_training_session", command),
    ]);
    for (const result of results) expect(result.error).toBeNull();
    expect(results.map((r) => r.data.replayed).sort()).toEqual([false, true]);
    const ended = results[0].data.session as SessionSnapshot;
    expect(ended).toMatchObject({
      id: s.id,
      status: "ended",
      phase: "ended",
      revision: 1,
      currentIndex: null,
      completedAt: null,
      endedAt: ended.updatedAt,
    });
    expect(ended.items).toEqual(s.items);
    expect(await rpc(user.client, "get_active_training_session")).toBeNull();
    const next = await start(user);
    expect(next.id).not.toBe(s.id);
    expect(
      (
        await rpc<SessionMutationResponse>(
          client,
          "end_training_session",
          command,
        )
      ).session,
    ).toEqual(ended);
    expect(
      (
        await client.rpc("end_training_session", {
          ...command,
          p_expected_revision: 1,
        })
      ).error?.message,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      (
        await client.rpc("submit_session_answer", {
          ...answerArgs(s),
          p_expected_revision: 1,
        })
      ).error?.message,
    ).toBe("SESSION_CONFLICT");
    expect(await read(user, s.id)).toEqual(ended);
  });
  it("retains a saved answer, exact pinned versions and old answer receipts after ending review", async () => {
    const user = await learner(),
      s = await start(user),
      answer = answerArgs(s);
    const review = (
      await rpc<SessionMutationResponse>(
        user.client,
        "submit_session_answer",
        answer,
      )
    ).session;
    expect(
      (await user.client.rpc("end_training_session", endArgs(s))).error
        ?.message,
    ).toBe("SESSION_CONFLICT");
    const ended = (
      await rpc<SessionMutationResponse>(
        user.client,
        "end_training_session",
        endArgs(review),
      )
    ).session;
    expect(ended.revision).toBe(2);
    expect(ended.items).toEqual(review.items);
    expect(ended.items.slice(1).every((i) => i.answer === null)).toBe(true);
    expect(
      (
        await rpc<SessionMutationResponse>(
          user.client,
          "submit_session_answer",
          answer,
        )
      ).session,
    ).toEqual(ended);
    const history = await rpc<{
      sessions: {
        id: string;
        status: string;
        answeredCount: number;
        totalCount: number;
      }[];
    }>(user.client, "list_training_sessions");
    expect(history.sessions.find((i) => i.id === s.id)).toMatchObject({
      status: "ended",
      answeredCount: 1,
      totalCount: 3,
    });
    const stranger = await learner();
    expect(
      (await stranger.client.rpc("end_training_session", endArgs(ended))).error
        ?.message,
    ).toBe("SESSION_NOT_FOUND");
    expect(
      (
        await stranger.client.rpc("get_training_session", {
          p_session_id: s.id,
        })
      ).error?.message,
    ).toBe("SESSION_NOT_FOUND");
  });
  it.each(["answer", "advance"] as const)(
    "serializes End versus %s behind the real actor lock",
    async (kind) => {
      const user = await learner(),
        client = await independentClient(user);
      let s = await start(user);
      if (kind === "advance")
        s = (
          await rpc<SessionMutationResponse>(
            user.client,
            "submit_session_answer",
            answerArgs(s),
          )
        ).session;
      const args = endArgs(s);
      const operation =
        kind === "answer"
          ? () => client.rpc("submit_session_answer", answerArgs(s))
          : () =>
              client.rpc("advance_training_session", {
                p_session_id: s.id,
                p_from_item_id: s.items[s.currentIndex!].id,
                p_request_id: randomUUID(),
                p_expected_revision: s.revision,
              });
      const results = await raceBehindLock(user.id, 0, [
        () => user.client.rpc("end_training_session", args),
        operation,
      ]);
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      expect(results.find((r) => r.error)?.error?.message).toBe(
        "SESSION_CONFLICT",
      );
      const final = await read(user, s.id);
      expect(final.revision).toBe(s.revision + 1);
      if (final.phase === "ended") expect(final.items).toEqual(s.items);
      else {
        expect(final.phase).toBe(kind === "answer" ? "review" : "setup");
        expect(
          (
            await rpc<SessionMutationResponse>(
              user.client,
              "end_training_session",
              endArgs(final),
            )
          ).session.phase,
        ).toBe("ended");
      }
    },
  );
  it("serializes End versus a different new start without losing either history or active uniqueness", async () => {
    const user = await learner(),
      client = await independentClient(user),
      s = await start(user);
    const results = await raceBehindLock(user.id, 0, [
      () => user.client.rpc("end_training_session", endArgs(s)),
      () =>
        client.rpc("start_selected_training_session", {
          p_request_id: randomUUID(),
          p_target: { kind: "scenario", scenarioId: s.items[0].challenge.id },
        }),
    ]);
    expect(results[0].error).toBeNull();
    if (results[1].error)
      expect(results[1].error.message).toBe("ACTIVE_SESSION_EXISTS");
    else expect(results[1].data.session.id).not.toBe(s.id);
    expect((await read(user, s.id)).phase).toBe("ended");
    const active = await user.client
      .from("training_sessions")
      .select("id")
      .in("phase", ["setup", "review"]);
    expect(active.error).toBeNull();
    expect(active.data!.length).toBeLessThanOrEqual(1);
  });
  it("requires normal Finish for a fully answered run and never relabels completed history", async () => {
    const user = await learner();
    let s = await start(user);
    while (true) {
      s = (
        await rpc<SessionMutationResponse>(
          user.client,
          "submit_session_answer",
          answerArgs(s),
        )
      ).session;
      if (s.currentIndex === s.items.length - 1) break;
      s = (
        await rpc<SessionMutationResponse>(
          user.client,
          "advance_training_session",
          {
            p_session_id: s.id,
            p_from_item_id: s.items[s.currentIndex!].id,
            p_request_id: randomUUID(),
            p_expected_revision: s.revision,
          },
        )
      ).session;
    }
    expect(
      (await user.client.rpc("end_training_session", endArgs(s))).error
        ?.message,
    ).toBe("SESSION_CONFLICT");
    const completed = (
      await rpc<SessionMutationResponse>(
        user.client,
        "advance_training_session",
        {
          p_session_id: s.id,
          p_from_item_id: s.items[s.currentIndex!].id,
          p_request_id: randomUUID(),
          p_expected_revision: s.revision,
        },
      )
    ).session;
    expect(completed).toMatchObject({
      status: "completed",
      endedAt: null,
      revision: 6,
    });
    expect(
      (await user.client.rpc("end_training_session", endArgs(completed))).error
        ?.message,
    ).toBe("SESSION_CONFLICT");
    expect(await read(user, s.id)).toEqual(completed);
  });
});
