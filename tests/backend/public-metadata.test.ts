import { beforeEach, expect, it, vi } from "vitest";
import {
  getSiteMetadata,
  getPublicPageMetadata,
  getPrivatePageMetadata,
  getUnavailableMetadata,
} from "@/server/metadata";
import robots from "@/app/robots";

const config = vi.hoisted(() => ({
  appOrigin: "https://would-you-peek.example",
  releaseEnvironment: "production",
}));
vi.mock("@/server/config", () => ({ getServerAppConfig: () => config }));
beforeEach(() => {
  config.releaseEnvironment = "production";
});

it("uses the configured origin and bounded public fields in canonical metadata", () => {
  expect(getSiteMetadata().metadataBase?.toString()).toBe(
    "https://would-you-peek.example/",
  );
  const result = getPublicPageMetadata({
    title: "Title\n" + "x".repeat(200),
    description: "d".repeat(400),
    path: "/library/scenario-1",
  });
  expect(result.alternates?.canonical).toBe(
    "https://would-you-peek.example/library/scenario-1",
  );
  expect(String(result.title)).toHaveLength(160);
  expect(result.description).toHaveLength(320);
  expect(result.title).not.toContain("\n");
  expect(result.robots).toEqual({ index: true, follow: true });
});

it.each([
  "https://attacker.example",
  "//attacker.example",
  "/library?token=secret",
  "/../account",
  "/library#answer",
])("rejects a noncanonical path %s", (path) => {
  expect(() => getPublicPageMetadata({ title: "Title", path })).toThrow(
    "canonical",
  );
});

it.each(["preview", "local"])(
  "does not index %s deployments",
  (environment) => {
    config.releaseEnvironment = environment;
    expect(getSiteMetadata().robots).toEqual({ index: false, follow: false });
    expect(
      getPublicPageMetadata({ title: "Library", path: "/library" }).robots,
    ).toEqual({ index: false, follow: false });
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  },
);

it("keeps private and unavailable metadata unindexed and without a content canonical", () => {
  expect(getPrivatePageMetadata("Operator reports").robots).toEqual({
    index: false,
    follow: false,
  });
  expect(
    getUnavailableMetadata("Unavailable").alternates?.canonical,
  ).toBeNull();
  expect(robots().rules).toEqual(
    expect.objectContaining({
      allow: "/",
      disallow: expect.arrayContaining([
        "/auth/",
        "/operator",
        "/creator",
        "/api/",
      ]),
    }),
  );
});
