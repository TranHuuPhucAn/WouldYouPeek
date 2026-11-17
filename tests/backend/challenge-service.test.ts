import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/http";
import {
  getChallenge,
  listChallenges,
  parseAnswerRequest,
  submitAnswer,
} from "../fixtures/authored-challenges";

const EXPECTED = [
  {
    id: "bind-clove-utility-window",
    observed: "use-meddle",
    choices: [
      ["use-meddle", "reasonable"],
      ["cover-contact", "reasonable"],
      ["advance-with-team", "reasonable"],
    ],
  },
  {
    id: "bind-clove-smoke-contest",
    observed: "contest-short",
    choices: [
      ["contest-short", "risky"],
      ["hold-exit", "reasonable"],
      ["coordinate-reset", "reasonable"],
    ],
  },
  {
    id: "bind-clove-advantage-reset",
    observed: "clear-forward",
    choices: [
      ["clear-forward", "reasonable"],
      ["hold-route", "reasonable"],
      ["regroup", "reasonable"],
    ],
  },
];

describe("authored scenario fixture regressions", () => {
  it("lists only summaries in the authored order", () => {
    const summaries = listChallenges();
    expect(summaries.map(({ id }) => id)).toEqual(EXPECTED.map(({ id }) => id));
    for (const summary of summaries)
      expect(Object.keys(summary).sort()).toEqual([
        "id",
        "mediaStatus",
        "order",
        "title",
        "topic",
      ]);
  });

  it.each(EXPECTED)("returns only pre-answer fields for $id", ({ id }) => {
    const detail = getChallenge(id);
    const fields = [
      "contentVersion",
      "context",
      "decision",
      "id",
      "knownFacts",
      "mediaStatus",
      "options",
      "order",
      "question",
      "setup",
      "source",
      "title",
      "topic",
      "unknowns",
    ];
    if (id === "bind-clove-advantage-reset") fields.push("linkedScenarioId");
    expect(Object.keys(detail).sort()).toEqual(fields.sort());
    for (const option of detail.options)
      expect(Object.keys(option).sort()).toEqual(["id", "label"]);
    expect(Object.keys(detail.setup).sort()).toEqual([
      "alt",
      "caption",
      "endSeconds",
      "kind",
      "startSeconds",
      "videoId",
    ]);
    expect(Object.keys(detail.decision).sort()).toEqual([
      "alt",
      "atSeconds",
      "kind",
    ]);
    expect(Object.keys(detail.source!).sort()).toEqual([
      "agent",
      "dateNote",
      "kind",
      "map",
      "matchType",
      "player",
      "publishedDate",
      "round",
      "score",
      "side",
      "title",
      "uploader",
      "url",
      "videoId",
    ]);
    for (const forbidden of [
      "reveal",
      "takeaway",
      "outcomeText",
      "observedAction",
      "matchesPro",
      "analysis",
      "optionFeedback",
      "recommendedOptionIds",
      "review",
    ])
      expect(detail).not.toHaveProperty(forbidden);
  });

  it("does not disclose the future spike-carrier result before the smoke decision", () => {
    const detail = getChallenge("bind-clove-smoke-contest");
    const visibleText = JSON.stringify(detail).toLowerCase();
    expect(visibleText).not.toContain("fade");
    expect(visibleText).not.toContain("spike carrier");
    expect(visibleText).not.toContain("spike-carrier");
    expect(visibleText).not.toContain("kills");
  });

  it("cannot mutate future details through returned nested objects", () => {
    const expected = getChallenge("bind-clove-utility-window");
    const changed = getChallenge(expected.id);
    changed.options[0].label = "mutated";
    changed.source!.player = "mutated";
    changed.knownFacts!.push("mutated");
    changed.unknowns![0] = "mutated";
    changed.setup.alt = "mutated";
    if (changed.setup.kind === "youtube") changed.setup.startSeconds = 0;
    changed.decision.alt = "mutated";
    expect(getChallenge(expected.id)).toEqual(expected);
  });

  it("rejects unknown challenge IDs", () => {
    expect(() => getChallenge("missing")).toThrowError(
      expect.objectContaining({ code: "CHALLENGE_NOT_FOUND" }),
    );
    expect(() =>
      submitAnswer("missing", { optionId: "hold-exit" }),
    ).toThrowError(ApiError);
  });
});

describe("answer request parsing", () => {
  it("accepts a single nonempty option ID", () => {
    expect(parseAnswerRequest({ optionId: "hold-exit" })).toEqual({
      optionId: "hold-exit",
    });
  });

  it.each([
    null,
    undefined,
    [],
    "hold-exit",
    123,
    {},
    { optionId: null },
    { optionId: 1 },
    { optionId: "" },
    { optionId: "   " },
    { optionId: " hold-exit " },
    { optionId: "hold-exit", score: 3 },
  ])("rejects invalid input %#", (value) => {
    expect(() => parseAnswerRequest(value)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});

describe("independent action comparison and assessment", () => {
  for (const scenario of EXPECTED) {
    it.each(scenario.choices)(
      `${scenario.id}: evaluates %s as %s`,
      (optionId, assessment) => {
        const answer = submitAnswer(scenario.id, { optionId });
        expect(answer.challengeId).toBe(scenario.id);
        expect(answer.contentVersion).toBe("vod-1");
        expect(answer.selectedOptionId).toBe(optionId);
        expect(answer.selectedAssessment).toBe(assessment);
        expect(answer.observedAction?.optionId).toBe(scenario.observed);
        expect(answer.matchesPro).toBe(optionId === scenario.observed);
        expect(answer.recommendedOptionIds).toEqual([]);
        expect(
          answer.optionFeedback.map(({ optionId, assessment }) => [
            optionId,
            assessment,
          ]),
        ).toEqual(scenario.choices);
        for (const option of answer.optionFeedback) {
          expect(option.explanation.length).toBeGreaterThan(0);
          expect(option.acceptableWhen.length).toBeGreaterThan(0);
          expect(option.risks.length).toBeGreaterThan(0);
        }
        expect(answer.analysis).toMatchObject({ author: "ai" });
        expect(answer.analysis!.notice).toContain("interpretation");
        expect(answer.analysis!.limitations.length).toBeGreaterThan(0);
        expect(answer.takeaway.length).toBeGreaterThan(0);
        expect(answer.outcomeText.length).toBeGreaterThan(0);
        expect(answer.reveal).toMatchObject({
          kind: "youtube",
          videoId: "_yPrykaB2nE",
        });
        expect(answer).not.toHaveProperty("review");
      },
    );
  }

  it("can match the pro while receiving a risky assessment", () => {
    expect(
      submitAnswer("bind-clove-smoke-contest", { optionId: "contest-short" }),
    ).toMatchObject({
      matchesPro: true,
      selectedAssessment: "risky",
      recommendedOptionIds: [],
    });
  });

  it("can differ from the pro while remaining defensible", () => {
    expect(
      submitAnswer("bind-clove-smoke-contest", { optionId: "hold-exit" }),
    ).toMatchObject({
      matchesPro: false,
      selectedAssessment: "reasonable",
    });
  });

  it("rejects an option that belongs to another challenge", () => {
    expect(() =>
      submitAnswer("bind-clove-utility-window", { optionId: "hold-exit" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_OPTION" }));
  });

  it("returns deterministic feedback with independent nested objects", () => {
    const id = "bind-clove-smoke-contest";
    const request = { optionId: "hold-exit" };
    const expected = submitAnswer(id, request);
    const changed = submitAnswer(id, request);
    expect(changed).toEqual(expected);
    changed.reveal.alt = "mutated";
    if (changed.reveal.kind === "youtube") changed.reveal.endSeconds = 9999;
    changed.observedAction!.description = "mutated";
    changed.analysis!.limitations.push("mutated");
    changed.analysis!.rationale = "mutated";
    changed.optionFeedback[0].acceptableWhen.push("mutated");
    changed.optionFeedback[0].risks[0] = "mutated";
    changed.optionFeedback[0].explanation = "mutated";
    changed.recommendedOptionIds.push("mutated");
    expect(submitAnswer(id, request)).toEqual(expected);
  });
});
