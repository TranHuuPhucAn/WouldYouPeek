import { afterAll, describe, expect, it } from "vitest";
import { parseHtml } from "./helpers/html.mjs";
import {
  createLocalTestClient,
  readEmailLink,
} from "../integration/helpers/local-supabase";
import {
  cleanupTestUsers,
  createVerifiedTestUser,
  newTestCredentials,
} from "../integration/helpers/test-users";
import { appOrigin } from "./helpers/browser";

function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}
async function renderedForm(url: URL, field: string, cookies = "") {
  const response = await fetch(url, {
    headers: cookies ? { Cookie: cookies } : {},
    redirect: "manual",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const document = parseHtml(await response.text(), url.toString());
  const form = document
    .querySelector(`input[name="${field}"]`)
    ?.closest("form");
  expect(Boolean(form)).toBe(true);
  const data = new FormData();
  for (const input of form!.querySelectorAll<HTMLInputElement>("input[name]"))
    data.append(input.name, input.value);
  // React's progressive-enhancement metadata comes from this actual rendered form.
  expect([...data.keys()].some((key) => key.startsWith("$ACTION_"))).toBe(true);
  return {
    url: new URL(form!.getAttribute("action") || url.toString(), url),
    data,
  };
}
async function submit(form: { url: URL; data: FormData }, cookies = "") {
  return fetch(form.url, {
    method: "POST",
    body: form.data,
    redirect: "manual",
    headers: {
      Origin: appOrigin(),
      "Sec-Fetch-Site": "same-origin",
      ...(cookies ? { Cookie: cookies } : {}),
    },
  });
}
async function scanLink(confirmation: URL) {
  let landing: URL | undefined;
  for (const method of ["GET", "HEAD", "GET"]) {
    const response = await fetch(confirmation, { method, redirect: "manual" });
    expect(response.status).toBe(303);
    landing = new URL(response.headers.get("location")!);
    expect(landing.pathname).toBe("/auth/confirm-email");
    expect(landing.origin).toBe(appOrigin());
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.getSetCookie().length).toBe(0);
  }
  return landing!;
}

describe("email confirmation through the actual explicit form", () => {
  const users: { id: string }[] = [];
  afterAll(async () => cleanupTestUsers(users));
  it.each([
    { resend: false, destination: "/library/bind-clove-smoke-contest" },
    { resend: true, destination: "/library/bind-clove-smoke-contest" },
    {
      resend: false,
      destination: "/library/playlists/7ecf3523-18cb-5cbe-a307-5b5cd43d1836",
    },
    {
      resend: true,
      destination:
        "/creator/playlists/7ecf3523-18cb-5cbe-a307-5b5cd43d1836/review",
    },
    { resend: false, destination: "/operator/reports" },
  ])(
    "preserves $destination through scanner reads and explicit verification (resend=$resend)",
    async ({ resend, destination }) => {
      const origin = appOrigin();
      const callback = (next: string) => {
        const url = new URL("/auth/confirm", origin);
        url.searchParams.set("next", next);
        return url.toString();
      };
      const credentials = newTestCredentials(),
        client = createLocalTestClient();
      const signup = await client.auth.signUp({
        ...credentials,
        options: {
          emailRedirectTo: callback(resend ? "/library" : destination),
        },
      });
      expect(signup.error).toBeNull();
      expect(signup.data.user?.id).toBeTruthy();
      const id = signup.data.user!.id;
      users.push({ id });
      if (resend) {
        await readEmailLink(credentials.email, "signup", "/library");
        await new Promise((done) => setTimeout(done, 1100));
        expect(
          (
            await client.auth.resend({
              type: "signup",
              email: credentials.email,
              options: { emailRedirectTo: callback(destination) },
            })
          ).error,
        ).toBeNull();
      }
      const confirmation = await readEmailLink(
        credentials.email,
        "signup",
        destination,
      );
      const landing = await scanLink(confirmation);
      const form = await renderedForm(landing, "token_hash");
      const admin = createLocalTestClient("admin");
      expect(
        (await admin.auth.admin.getUserById(id)).data.user?.email_confirmed_at,
      ).toBeFalsy();
      const response = await submit(form);
      expect(response.status).toBe(303);
      expect(
        new URL(response.headers.get("location")!, origin).toString(),
      ).toBe(`${origin}${destination}`);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const cookies = cookieHeader(response);
      expect(cookies.length).toBeGreaterThan(0);
      const account = await fetch(`${origin}/api/account`, {
        headers: { Cookie: cookies },
      });
      expect(account.status).toBe(200);
      expect(await account.json()).toMatchObject({
        id,
        emailVerified: true,
        role: "learner",
      });
      // Reopening a used link stays read-only; explicit replay gets a useful error.
      const replay = await submit(
        await renderedForm(await scanLink(confirmation), "token_hash"),
      );
      expect(replay.status).toBe(200);
      expect((await replay.text()).includes("invalid or expired")).toBe(true);
    },
    35_000,
  );

  it("lets a fresh browser confirm recovery and change the password", async () => {
    const user = await createVerifiedTestUser();
    users.push(user);
    const reset = await user.client.auth.resetPasswordForEmail(user.email);
    expect(reset.error).toBeNull();
    const confirmation = await readEmailLink(
      user.email,
      "recovery",
      "/reset-password",
    );
    const verified = await submit(
      await renderedForm(await scanLink(confirmation), "token_hash"),
    );
    expect(verified.status).toBe(303);
    expect(
      new URL(verified.headers.get("location")!, appOrigin()).pathname,
    ).toBe("/reset-password");
    const cookies = cookieHeader(verified);
    const form = await renderedForm(
      new URL("/reset-password", appOrigin()),
      "password",
      cookies,
    );
    const password = `Changed-${user.password}`;
    form.data.set("password", password);
    form.data.set("confirmPassword", password);
    const changed = await submit(form, cookies);
    expect(changed.status).toBe(303);
    expect(
      new URL(changed.headers.get("location")!, appOrigin()).pathname,
    ).toBe("/account");
    expect(
      (
        await createLocalTestClient().auth.signInWithPassword({
          email: user.email,
          password: user.password,
        })
      ).error,
    ).toBeTruthy();
    expect(
      (
        await createLocalTestClient().auth.signInWithPassword({
          email: user.email,
          password,
        })
      ).error,
    ).toBeNull();
  }, 35_000);
});
