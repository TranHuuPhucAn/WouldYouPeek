import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreatorDraftContent,
  CreatorMutationResponse,
  CreatorScenarioSnapshot,
  ReviewChecklist,
} from "@/contracts/creator";
import { REVIEW_CHECKLIST_KEYS } from "@/contracts/creator";
import type {
  CreateSessionResponse,
  SessionMutationResponse,
  SessionSnapshot,
} from "@/contracts/session";
import vectors from "../../fixtures/creator-content-cases.json";
import { createVerifiedTestUser, type TestUser } from "./test-users";
import { createLocalTestClient, getLocalTestConfig } from "./local-supabase";

export function validContent(): CreatorDraftContent {
  return structuredClone(vectors.validContent) as CreatorDraftContent;
}
export function checklist(): ReviewChecklist {
  return Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((k) => [k, true]),
  ) as ReviewChecklist;
}
export async function rpc<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  getLocalTestConfig();
  const result = await client.rpc(name, args);
  expect(result.error, `${name} must succeed`).toBeNull();
  return result.data as T;
}
export async function createVerifiedCreator(): Promise<TestUser> {
  const user = await createVerifiedTestUser();
  await rpc(user.client, "enable_creator");
  return user;
}
export async function independentClient(
  user: TestUser,
): Promise<SupabaseClient> {
  const client = createLocalTestClient();
  const result = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (result.error)
    throw new Error("Could not create an independent local test session.");
  return client;
}
export async function createDraftFixture(
  user: TestUser,
  content = validContent(),
): Promise<CreatorScenarioSnapshot> {
  const created = await rpc<CreatorMutationResponse>(
    user.client,
    "create_creator_scenario",
    { p_request_id: randomUUID() },
  );
  return saveDraftFixture(user, created.scenario, content);
}
export async function saveDraftFixture(
  user: TestUser,
  snapshot: CreatorScenarioSnapshot,
  content: CreatorDraftContent,
): Promise<CreatorScenarioSnapshot> {
  const result = await rpc<CreatorMutationResponse>(
    user.client,
    "save_creator_scenario",
    {
      p_scenario_id: snapshot.id,
      p_request_id: randomUUID(),
      p_expected_revision: snapshot.revision,
      p_content: content,
    },
  );
  return result.scenario;
}
export async function reviewDraftFixture(
  user: TestUser,
  snapshot: CreatorScenarioSnapshot,
): Promise<CreatorScenarioSnapshot> {
  return (
    await rpc<CreatorMutationResponse>(user.client, "review_creator_scenario", {
      p_scenario_id: snapshot.id,
      p_request_id: randomUUID(),
      p_expected_revision: snapshot.revision,
      p_checklist: checklist(),
    })
  ).scenario;
}
export async function publishScenarioFixture(
  user: TestUser,
  content = validContent(),
): Promise<CreatorScenarioSnapshot> {
  const ready = await reviewDraftFixture(
    user,
    await createDraftFixture(user, content),
  );
  return (
    await rpc<CreatorMutationResponse>(
      user.client,
      "publish_creator_scenario",
      {
        p_scenario_id: ready.id,
        p_request_id: randomUUID(),
        p_expected_revision: ready.revision,
        p_review_id: ready.review!.id,
      },
    )
  ).scenario;
}
export async function startSingle(
  user: TestUser,
  scenarioId: string,
): Promise<SessionSnapshot> {
  return (
    await rpc<CreateSessionResponse>(
      user.client,
      "start_selected_training_session",
      {
        p_request_id: randomUUID(),
        p_target: { kind: "scenario", scenarioId },
      },
    )
  ).session;
}
export async function finishSession(
  user: TestUser,
  original: SessionSnapshot,
): Promise<SessionSnapshot> {
  let session = original;
  while (session.phase !== "completed") {
    const item = session.items[session.currentIndex!];
    if (session.phase === "setup")
      session = (
        await rpc<SessionMutationResponse>(
          user.client,
          "submit_session_answer",
          {
            p_session_id: session.id,
            p_item_id: item.id,
            p_option_id: item.challenge.options[0].id,
            p_request_id: randomUUID(),
            p_expected_revision: session.revision,
          },
        )
      ).session;
    else
      session = (
        await rpc<SessionMutationResponse>(
          user.client,
          "advance_training_session",
          {
            p_session_id: session.id,
            p_from_item_id: item.id,
            p_request_id: randomUUID(),
            p_expected_revision: session.revision,
          },
        )
      ).session;
  }
  return session;
}
/** Release independent HTTP clients together; the database must produce a serial result. */
export async function race<T>(
  ...commands: (() => PromiseLike<T>)[]
): Promise<T[]> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => (release = resolve));
  const pending = commands.map(async (command) => {
    await barrier;
    return command();
  });
  release();
  return Promise.all(pending);
}
