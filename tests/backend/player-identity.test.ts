import { describe, expect, it } from "vitest";
import cases from "../fixtures/player-identity.json";
import {
  normalizePlayerDisplayName,
  normalizePlayerKey,
} from "@/lib/players/identity";
import { isScenarioId, normalizeScenarioId } from "@/lib/scenario-id";
describe("canonical player identity corpus", () => {
  it("preserves maximum-length source names and their full NFKC expansion", () => {
    const expanded = normalizePlayerDisplayName("\uFDFA".repeat(300));
    expect([...expanded]).toHaveLength(5400);
    expect(normalizePlayerDisplayName(expanded)).toBe(expanded);
    expect(normalizePlayerKey(expanded)).toBe(
      normalizePlayerKey("\uFDFA".repeat(300)),
    );
    expect(normalizePlayerDisplayName("🎮".repeat(300))).toHaveLength(600);
  });
  it.each(cases)(
    "normalizes $input with explicit Unicode and case rules",
    ({ input, displayName, key }) => {
      expect(normalizePlayerDisplayName(input)).toBe(displayName);
      expect(normalizePlayerKey(input)).toBe(key);
      expect(normalizePlayerKey(key)).toBe(key);
    },
  );
  it.each(["", " \t\n", "A\u0001B", "A\u007fB", "A\u009fB", "a".repeat(5401)])(
    "rejects invalid names",
    (value) => expect(() => normalizePlayerDisplayName(value)).toThrow(),
  );
  it("counts Unicode code points, preserves distinct punctuation and uses ASCII-only case folding", () => {
    expect(normalizePlayerDisplayName("🎮".repeat(200))).toHaveLength(400);
    expect(normalizePlayerKey("Ten-Z")).not.toBe(normalizePlayerKey("TenZ"));
    expect(normalizePlayerKey("É")).not.toBe(normalizePlayerKey("é"));
  });
});
describe("scenario-only identifiers", () => {
  it.each([
    "bind-clove-utility-window",
    "76AF0A04-4751-4D26-9233-183A252E124B",
  ])("accepts UUID and existing slug %s", (id) =>
    expect(isScenarioId(id)).toBe(true),
  );
  it.each([
    "tenz",
    "../scenario",
    "A-slug",
    "--slug",
    "a--b",
    "a_b",
    "a/../b",
    "a-".repeat(51),
    null,
    1,
  ])("rejects malformed identifier %s", (id) =>
    expect(isScenarioId(id)).toBe(false),
  );
  it("canonicalizes UUID casing without changing slug identity", () => {
    expect(normalizeScenarioId("76AF0A04-4751-4D26-9233-183A252E124B")).toBe(
      "76af0a04-4751-4d26-9233-183a252e124b",
    );
    expect(normalizeScenarioId("bind-clove-utility-window")).toBe(
      "bind-clove-utility-window",
    );
  });
});
