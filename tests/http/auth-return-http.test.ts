import { afterAll, describe, expect, it } from "vitest";
import {
  createLocalTestClient,
  readEmailLink,
} from "../integration/helpers/local-supabase";
import {
  cleanupTestUsers,
  newTestCredentials,
} from "../integration/helpers/test-users";
import { appOrigin } from "./helpers/browser";

describe("captured verification email through the actual callback", () => {
  const users: { id: string }[] = [];
  afterAll(async () => cleanupTestUsers(users));

  it.each([false, true])(
    "keeps selected scenario and establishes verified cookies (resend=%s)",
    async (resend) => {
      const origin = appOrigin();
      const destination = "/library/bind-clove-smoke-contest";
      const callback = (next: string) => {
        const url = new URL("/auth/confirm", origin);
        url.searchParams.set("next", next);
        return url.toString();
      };
      const credentials = newTestCredentials();
      const client = createLocalTestClient();
      const signup = await client.auth.signUp({
        ...credentials,
        options: {
          emailRedirectTo: callback(resend ? "/library" : destination),
        },
      });
      expect(signup.error).toBeNull();
      expect(signup.data.user?.id).toBeTruthy();
      users.push({ id: signup.data.user!.id });
      if (resend) {
        await readEmailLink(credentials.email, "signup", "/library");
        await new Promise((done) => setTimeout(done, 1100));
        const sent = await client.auth.resend({
          type: "signup",
          email: credentials.email,
          options: { emailRedirectTo: callback(destination) },
        });
        expect(sent.error).toBeNull();
      }
      const confirmation = await readEmailLink(
        credentials.email,
        "signup",
        destination,
      );
      expect(confirmation.origin).toBe(origin);
      const response = await fetch(confirmation, { redirect: "manual" });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${origin}${destination}`);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const cookies = response.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      expect(cookies.length).toBeGreaterThan(0);
      const account = await fetch(`${origin}/api/account`, {
        headers: { Cookie: cookies },
      });
      expect(account.status).toBe(200);
      expect(await account.json()).toMatchObject({
        id: signup.data.user!.id,
        emailVerified: true,
        role: "learner",
      });
      const replay = await fetch(confirmation, { redirect: "manual" });
      expect(replay.status).toBe(303);
      const failed = new URL(replay.headers.get("location")!);
      expect(failed.pathname).toBe("/auth/error");
      expect(failed.searchParams.get("returnTo")).toBe(destination);
      expect(failed.searchParams.has("token_hash")).toBe(false);
    },
    35_000,
  );
});
