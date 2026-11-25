import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  readFixtures,
  renderSeedSql,
  validateFixtures,
  validateCuratedPlaylist,
} from "../../scripts/render-demo-seed.mjs";

describe("canonical demo seed", () => {
  it("keeps the editorial starter canonical and rejects changed order/version", async () => {
    const fixtures = await readFixtures();
    const playlist = JSON.parse(
      await readFile(
        new URL(
          "../../supabase/fixtures/curated-playlist.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(validateCuratedPlaylist(playlist, fixtures)).toBe(playlist);
    expect(() =>
      validateCuratedPlaylist(
        { ...playlist, items: [...playlist.items].reverse() },
        fixtures,
      ),
    ).toThrow();
    expect(() =>
      validateCuratedPlaylist(
        {
          ...playlist,
          items: playlist.items.map((item: object) => ({
            ...item,
            scenarioVersion: "changed",
          })),
        },
        fixtures,
      ),
    ).toThrow();
    const sql = renderSeedSql(fixtures);
    expect(sql).toContain("private.ensure_curated_starter_playlist()");
    expect(sql).toContain("p.creator_id is null");
    expect(sql).not.toContain("insert into auth.users");
  });
  it("renders exactly the committed SQL deterministically", async () => {
    const fixtures = await readFixtures();
    const rendered = renderSeedSql(fixtures);
    expect(rendered).toBe(
      await readFile(
        new URL("../../supabase/seed.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(renderSeedSql(structuredClone(fixtures))).toBe(rendered);
    expect(renderSeedSql([...fixtures].reverse())).toBe(rendered);
  });

  it("escapes authored SQL strings and preserves a changed-version guard", async () => {
    const fixtures = await readFixtures();
    fixtures[0].title = "Don't peek'); drop table public.profiles; --";
    const rendered = renderSeedSql(fixtures);
    expect(rendered).toContain(
      "Don''t peek''); drop table public.profiles; --",
    );
    expect(rendered).toContain(
      "Seed content changed under an existing version",
    );
    expect(rendered).toContain(
      "on conflict (scenario_id, content_version) do nothing",
    );
  });

  it.each(["duplicate", "observed", "linked", "timing", "feedback", "source"])(
    "rejects invalid %s relationships",
    async (kind) => {
      const fixtures = await readFixtures();
      if (kind === "duplicate") fixtures[1].id = fixtures[0].id;
      if (kind === "observed") fixtures[0].observedAction.optionId = "invented";
      if (kind === "linked") fixtures[0].linkedScenarioId = "missing";
      if (kind === "timing")
        fixtures[0].setup.endSeconds = fixtures[0].setup.startSeconds;
      if (kind === "feedback") fixtures[0].options[0].assessment = "best";
      if (kind === "source") fixtures[0].source.videoId = "different";
      expect(() => validateFixtures(fixtures)).toThrow();
    },
  );

  it("keeps feedback and internal review out of public challenge JSON", async () => {
    const sql = renderSeedSql(await readFixtures());
    const safeInserts = [
      ...sql.matchAll(
        /insert into public\.scenario_versions\([\s\S]*?on conflict \(scenario_id, content_version\) do nothing;/g,
      ),
    ].map((match) => match[0]);
    expect(safeInserts).toHaveLength(3);
    for (const insert of safeInserts) {
      expect(insert).toContain('"options":[{"id":');
      for (const forbidden of [
        "assessment",
        "acceptableWhen",
        "observedAction",
        "reveal",
        "reviewedBy",
      ]) {
        expect(insert).not.toContain(`"${forbidden}"`);
      }
    }
  });
});
