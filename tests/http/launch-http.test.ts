import { describe, expect, it } from "vitest";
import { appOrigin } from "./helpers/browser";
import { api, loginBrowser } from "./helpers/browser";
import { createVerifiedCreator } from "../integration/helpers/creator-scenarios";
import { cleanupTestUsers } from "../integration/helpers/test-users";
import { moderationSql } from "../integration/helpers/moderation";
import { parseHtml } from "./helpers/html.mjs";

describe("public launch HTTP surface", () => {
  it("enforces YouTube-only UI and API admission before transport, then restores local uploads", async () => {
    const creator = await createVerifiedCreator();
    const browser = await loginBrowser(creator);
    const cookies = [...browser.jar]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    moderationSql(
      "update private.deployment_settings set source_mode='youtube-only' where singleton;",
    );
    try {
      const [list, create, page] = await Promise.all([
        api(browser, "/api/creator/videos"),
        api(browser, "/api/creator/videos", {}),
        fetch(`${appOrigin()}/creator/videos`, {
          headers: { Cookie: cookies },
        }),
      ]);
      for (const result of [list, create]) {
        expect(result.response.status).toBe(403);
        expect(result.data).toMatchObject({
          error: { code: "UPLOADS_DISABLED" },
        });
      }
      expect(page.status).toBe(200);
      const document = parseHtml(await page.text());
      expect(document.querySelector("h1")?.textContent).toBe(
        "Create with a YouTube recording.",
      );
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(document.querySelector('a[href="/creator/videos"]')).toBeNull();
    } finally {
      moderationSql(
        "update private.deployment_settings set source_mode='youtube-and-upload' where singleton;",
      );
      await cleanupTestUsers([creator]);
    }
  });
  it("exposes only bounded readiness and safe baseline headers", async () => {
    const response = await fetch(`${appOrigin()}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
  it.each(["/help", "/privacy", "/library"])(
    "serves the public page %s to guests",
    async (path) => {
      const response = await fetch(`${appOrigin()}${path}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html.includes("Would You Peek")).toBe(true);
    },
  );
  it.each([
    "/sign-in",
    "/forgot-password",
    "/auth/confirm-email?type=signup&token_hash=invalid",
  ])("protects private auth page %s from caching/indexing", async (path) => {
    const response = await fetch(`${appOrigin()}${path}`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    if (path.startsWith("/auth/"))
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
