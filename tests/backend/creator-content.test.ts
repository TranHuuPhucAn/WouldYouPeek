import { describe, expect, it } from "vitest";
import vectors from "../fixtures/creator-content-cases.json";
import {
  createEmptyDraft,
  normalizeDraftContent,
  parseYouTubeSource,
  validateDraftContent,
  validatePublishContent,
} from "@/lib/creator/content";
import type { CreatorDraftContent } from "@/contracts/creator";
function changed(path: string, value: unknown): unknown {
  const content = structuredClone(vectors.validContent) as unknown as Record<
    string,
    unknown
  >;
  const keys = path.split(".");
  let target = content;
  for (const key of keys.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = value;
  return content;
}
describe("creator draft and publication content", () => {
  it("keeps incomplete drafts valid and rejects publication until complete", () => {
    expect(validateDraftContent(createEmptyDraft())).toEqual([]);
    expect(validatePublishContent(createEmptyDraft()).length).toBeGreaterThan(
      0,
    );
    expect(validatePublishContent(vectors.validContent)).toEqual([]);
  });
  it.each(vectors.cases)("$name", (test) => {
    const value = changed(test.path, test.value);
    expect(validateDraftContent(value).length === 0).toBe(test.draftValid);
    expect(validatePublishContent(value).length === 0).toBe(test.publishValid);
  });
  it("normalizes documented whitespace and source aliases without changing the input", () => {
    const source = structuredClone(vectors.validContent) as CreatorDraftContent;
    source.title = "  A decision  ";
    source.unknowns = [" ", " missing comms "];
    if (source.source.kind === "uploaded")
      throw new Error("Expected the YouTube fixture.");
    source.source.url = "https://youtu.be/_yPrykaB2nE?t=10";
    const normalized = normalizeDraftContent(source);
    if (normalized.source.kind === "uploaded")
      throw new Error("Normalization changed the source kind.");
    expect(normalized.title).toBe("A decision");
    expect(normalized.unknowns).toEqual(["missing comms"]);
    expect(normalized.source.url).toBe(
      "https://www.youtube.com/watch?v=_yPrykaB2nE",
    );
    expect(source.title).toBe("  A decision  ");
  });
  it.each([
    "javascript:alert(1)",
    "http://youtube.com/watch?v=_yPrykaB2nE",
    "https://youtube.com:8443/watch?v=_yPrykaB2nE",
    "https://user:secret@youtube.com/watch?v=_yPrykaB2nE",
    "https://youtube.com/watch?v=_yPrykaB2nE&v=abcdefghijk",
    "https://youtu.be/_yPrykaB2nE?v=abcdefghijk",
    "https://youtube.com/playlist?list=x",
    "https://127.0.0.1/watch?v=_yPrykaB2nE",
    "https://www.youtube.com/foo/../watch?v=_yPrykaB2nE",
    "https://youtube.com/watch?v=_yPrykaB2nE&%76=_yPrykaB2nE",
    "https://youtube.com/watch?v=_yPrykaB2nE&v",
    "https://youtube.com/watch?v=%5FyPrykaB2nE",
    "https://youtube.com:443/watch?v=_yPrykaB2nE",
  ])("rejects unsafe/ambiguous source %s", (source) =>
    expect(parseYouTubeSource(source)).toBeNull(),
  );
  it.each([
    "https://youtu.be/_yPrykaB2nE?v=_yPrykaB2nE",
    "https://youtu.be/_yPrykaB2nE#?v=abcdefghijk",
    "https://youtube.com/watch?v=_yPrykaB2nE#?v=abcdefghijk",
  ])("keeps equivalent safe aliases %s", (source) =>
    expect(parseYouTubeSource(source)?.videoId).toBe("_yPrykaB2nE"),
  );
  it("accepts player choice even when it is not recommended", () => {
    const content = structuredClone(
      vectors.validContent,
    ) as CreatorDraftContent;
    content.options.forEach((o) => (o.assessment = "risky"));
    expect(validatePublishContent(content)).toEqual([]);
  });
  it("rejects malformed structures rather than coercing them", () => {
    for (const value of [
      null,
      [],
      true,
      "text",
      { ...createEmptyDraft(), extra: true },
    ])
      expect(validateDraftContent(value).length).toBeGreaterThan(0);
    expect(
      validateDraftContent(changed("media.startSeconds", Number.NaN)).length,
    ).toBeGreaterThan(0);
  });
});
