import { afterAll, describe, expect, it } from "vitest";
import {
  createLocalTestClient,
  readEmailLink,
  assertLocalTestTarget,
} from "./helpers/local-supabase";
import { cleanupTestUsers, newTestCredentials } from "./helpers/test-users";

describe("real local authentication and captured email", () => {
  const users: { id: string }[] = [];
  afterAll(async () => cleanupTestUsers(users));

  it("refuses hosted or ambiguous targets before destructive setup", () => {
    for (const value of [
      "https://example.supabase.co",
      "http://127.0.0.1:54321.evil.test",
      "http://127.0.0.1:54321@evil.test",
      "http://127.0.0.1:54321/path",
      "http://localhost:80",
      "https://localhost:54321",
    ]) {
      expect(() => assertLocalTestTarget(value)).toThrow();
    }
    expect(() => assertLocalTestTarget("http://127.0.0.1:54321")).toThrow();
    expect(assertLocalTestTarget("http://127.0.0.1:55321").port).toBe("55321");
  });

  it("requires real email confirmation, rejects replay, resets password and signs out", async () => {
    const credentials = newTestCredentials();
    const client = createLocalTestClient();
    const signup = await client.auth.signUp({
      ...credentials,
      options: { data: { role: "creator" } },
    });
    expect(signup.error).toBeNull();
    expect(signup.data.user?.id).toBeTruthy();
    users.push({ id: signup.data.user!.id });
    expect(signup.data.session).toBeNull();
    expect(
      (await client.auth.signInWithPassword(credentials)).error?.code,
    ).toBe("email_not_confirmed");
    const confirmation = await readEmailLink(credentials.email, "signup");
    expect(confirmation.searchParams.get("next")).toBe("/library");
    const token = confirmation.searchParams.get("token_hash")!;
    const verified = await client.auth.verifyOtp({
      type: "signup",
      token_hash: token,
    });
    expect(verified.error).toBeNull();
    expect(verified.data.user?.email_confirmed_at).toBeTruthy();
    expect(
      (await client.auth.verifyOtp({ type: "signup", token_hash: token }))
        .error,
    ).not.toBeNull();
    expect(
      (await client.from("profiles").select("role").single()).data?.role,
    ).toBe("learner");
    expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
    expect(
      (await client.auth.signInWithPassword(credentials)).error,
    ).toBeNull();
    expect(
      (await client.auth.resetPasswordForEmail(credentials.email)).error,
    ).toBeNull();
    const recovery = await readEmailLink(credentials.email, "recovery");
    const recoveryClient = createLocalTestClient();
    const recovered = await recoveryClient.auth.verifyOtp({
      type: "recovery",
      token_hash: recovery.searchParams.get("token_hash")!,
    });
    expect(recovered.error).toBeNull();
    const newPassword = `${credentials.password}-Changed2`;
    expect(
      (await recoveryClient.auth.updateUser({ password: newPassword })).error,
    ).toBeNull();
    await recoveryClient.auth.signOut({ scope: "local" });
    expect(
      (await client.auth.signInWithPassword(credentials)).error,
    ).not.toBeNull();
    expect(
      (
        await client.auth.signInWithPassword({
          email: credentials.email,
          password: newPassword,
        })
      ).error,
    ).toBeNull();
    expect((await client.auth.signOut({ scope: "local" })).error).toBeNull();
    expect((await client.auth.getSession()).data.session).toBeNull();
  }, 60_000);

  it("keeps the selected scenario in a real captured verification email", async () => {
    const credentials = newTestCredentials();
    const client = createLocalTestClient();
    const destination = "/library/bind-clove-smoke-contest";
    const callback = new URL(
      "/auth/confirm",
      process.env.SUPABASE_TEST_APP_URL,
    );
    callback.searchParams.set("next", destination);
    const signup = await client.auth.signUp({
      ...credentials,
      options: { emailRedirectTo: callback.toString() },
    });
    expect(signup.error).toBeNull();
    expect(signup.data.user?.id).toBeTruthy();
    users.push({ id: signup.data.user!.id });
    const confirmation = await readEmailLink(credentials.email, "signup");
    expect(confirmation.origin).toBe(callback.origin);
    expect(confirmation.pathname).toBe("/auth/confirm");
    expect(confirmation.searchParams.get("next")).toBe(destination);
    expect(confirmation.searchParams.getAll("token_hash")).toHaveLength(1);
    expect(
      (
        await client.auth.verifyOtp({
          type: "signup",
          token_hash: confirmation.searchParams.get("token_hash")!,
        })
      ).error,
    ).toBeNull();
  }, 30_000);
});
