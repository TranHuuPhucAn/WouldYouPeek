import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalTestClient, getLocalTestConfig } from "./local-supabase";

export type TestUser = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

export function newTestCredentials() {
  return {
    email: `wyp-${randomUUID()}@example.test`,
    password: `LocalOnly-${randomUUID()}-A1`,
  };
}

export async function createVerifiedTestUser(
  metadata: Record<string, unknown> = {},
): Promise<TestUser> {
  getLocalTestConfig();
  const admin = createLocalTestClient("admin");
  const { email, password } = newTestCredentials();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error || !data.user)
    throw new Error(
      `Could not create local test account: ${error?.message ?? "missing user"}`,
    );
  const client = createLocalTestClient();
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error("Could not sign in the local test account.");
  }
  return { id: data.user.id, email, password, client };
}

export async function cleanupTestUsers(users: Pick<TestUser, "id">[]) {
  getLocalTestConfig();
  const admin = createLocalTestClient("admin");
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error)
      throw new Error("Could not remove a local integration test account.");
  }
}
