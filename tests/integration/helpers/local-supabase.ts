import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertDisposableTarget } from "../../../scripts/local-target.mjs";

type LocalConfig = {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
  mailUrl: string;
};

/** URL validation supplements the owned disposable-workspace check below. */
export function assertLocalTestTarget(rawUrl: string, port = "55321"): URL {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Integration tests require the local Supabase service on port ${port}; hosted targets are refused.`,
    );
  }
  return url;
}

export function getLocalTestConfig(): LocalConfig {
  assertDisposableTarget(process.env);
  const url = process.env.SUPABASE_TEST_URL ?? "";
  const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "";
  const mailUrl = process.env.SUPABASE_TEST_MAIL_URL ?? "";
  if (!url || !publishableKey || !serviceRoleKey)
    throw new Error(
      "Disposable test credentials are missing. Use npm run test:ci.",
    );
  assertLocalTestTarget(url);
  assertLocalTestTarget(mailUrl, "55324");
  return { url, publishableKey, serviceRoleKey, mailUrl };
}

export function createLocalTestClient(
  kind: "anonymous" | "admin" = "anonymous",
): SupabaseClient {
  const config = getLocalTestConfig();
  return createClient(
    config.url,
    kind === "admin" ? config.serviceRoleKey : config.publishableKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/** Support the current Mailpit inbox and older local Inbucket installations. */
export async function readEmailLink(
  email: string,
  kind: "signup" | "recovery",
  expectedNext?: string,
): Promise<URL> {
  const { mailUrl } = getLocalTestConfig();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const listing = await fetch(`${mailUrl}/api/v1/messages`);
    let bodies: string[] = [];
    if (listing.ok) {
      const data = (await listing.json()) as {
        messages?: { ID: string; To?: { Address: string }[] }[];
      };
      for (const message of data.messages ?? []) {
        if (!message.To?.some((recipient) => recipient.Address === email))
          continue;
        const detail = await fetch(
          `${mailUrl}/api/v1/message/${encodeURIComponent(message.ID)}`,
        );
        const body = (await detail.json()) as { HTML?: string; Text?: string };
        bodies.push(`${body.HTML ?? ""}\n${body.Text ?? ""}`);
      }
    } else {
      const mailbox = encodeURIComponent(email.split("@")[0]);
      const response = await fetch(`${mailUrl}/api/v1/mailbox/${mailbox}`);
      if (response.ok) {
        const messages = (await response.json()) as { id: string }[];
        for (const message of messages) {
          const detail = await fetch(
            `${mailUrl}/api/v1/mailbox/${mailbox}/${encodeURIComponent(message.id)}`,
          );
          const body = (await detail.json()) as {
            body?: { html?: string; text?: string };
          };
          bodies.push(`${body.body?.html ?? ""}\n${body.body?.text ?? ""}`);
        }
      }
    }
    for (const body of bodies) {
      const links =
        body.replaceAll("&amp;", "&").match(/https?:\/\/[^\s<>"']+/g) ?? [];
      for (const link of links) {
        const url = new URL(link);
        if (
          url.pathname === "/auth/confirm" &&
          url.searchParams.get("type") === kind &&
          url.searchParams.has("token_hash") &&
          (expectedNext === undefined ||
            url.searchParams.get("next") === expectedNext)
        )
          return url;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `The local inbox did not receive a ${kind} email within 20 seconds.`,
  );
}
