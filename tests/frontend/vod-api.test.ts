import { describe, expect, it, vi } from "vitest";
import type { AnswerResponse, ChallengeDetail } from "@/contracts/challenge";
import { ChallengeApiError, getChallenges } from "@/lib/client/challenge-api";
import {
  parseChallengeDetail,
  parseAnswerResponse,
  validateAnswerForChallenge,
} from "@/lib/client/challenge-validation";
let payload: unknown;
async function getChallenge(_id: string) {
  return parseChallengeDetail(payload);
}
async function submitAnswer(_id: string, _request: { optionId: string }) {
  return parseAnswerResponse(payload);
}
import {
  getChallenge as getPublicChallenge,
  listChallenges,
  submitAnswer as getPublicAnswer,
} from "../fixtures/authored-challenges";

// Only this test imports public server projections to exercise the wire contract.
vi.mock("server-only", () => ({}));

const catalogue = listChallenges();
const firstId = "bind-clove-utility-window";

function vodDetail(id = firstId) {
  const detail = getPublicChallenge(id);
  if (
    detail.setup.kind !== "youtube" ||
    detail.decision.kind !== "paused-video" ||
    !detail.source
  )
    throw new Error("Expected a public VOD challenge fixture.");
  return {
    ...detail,
    setup: detail.setup,
    decision: detail.decision,
    source: detail.source,
  };
}

function vodAnswer() {
  const detail = vodDetail();
  const answer = getPublicAnswer(detail.id, { optionId: detail.options[0].id });
  if (
    answer.reveal.kind !== "youtube" ||
    !answer.observedAction ||
    !answer.analysis ||
    typeof answer.matchesPro !== "boolean"
  )
    throw new Error("Expected a public VOD answer fixture.");
  return {
    ...answer,
    reveal: answer.reveal,
    observedAction: answer.observedAction,
    analysis: answer.analysis,
    matchesPro: answer.matchesPro,
  };
}

function respondWith(body: unknown) {
  payload = body;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
}

const choices = catalogue.flatMap(({ id }) =>
  getPublicChallenge(id).options.map(({ id: optionId }) => ({ id, optionId })),
);

describe("real VOD public payloads through the client adapter", () => {
  it("accepts the complete three-scenario public catalogue", async () => {
    const previews = catalogue.map(({ id }) => {
      const { context, setup, source, ...detail } = getPublicChallenge(id);
      return {
        ...catalogue.find((item) => item.id === id)!,
        context,
        setup,
        source,
      };
    });
    respondWith({ challenges: previews });
    expect(await getChallenges()).toEqual(previews);
    expect(catalogue.map(({ id }) => id)).toEqual([
      "bind-clove-utility-window",
      "bind-clove-smoke-contest",
      "bind-clove-advantage-reset",
    ]);
    expect(choices).toHaveLength(9);
  });

  it.each(catalogue)(
    "accepts $id with its real source and pause",
    async ({ id }) => {
      const detail = getPublicChallenge(id);
      respondWith(detail);
      expect(await getChallenge(id)).toEqual(detail);
    },
  );

  it.each(choices)(
    "accepts $id / $optionId without requiring a recommended answer",
    async ({ id, optionId }) => {
      const detail = getPublicChallenge(id);
      const answer = getPublicAnswer(id, { optionId });
      respondWith(answer);
      const accepted = await submitAnswer(id, { optionId });
      expect(accepted).toEqual(answer);
      expect(accepted.recommendedOptionIds).toEqual([]);
      expect(() => validateAnswerForChallenge(accepted, detail)).not.toThrow();
    },
  );

  it.each([
    { optionId: "contest-short", matchesPro: true, assessment: "risky" },
    { optionId: "hold-exit", matchesPro: false, assessment: "reasonable" },
  ])(
    "keeps pro comparison independent of assessment for $optionId",
    async ({ optionId, matchesPro, assessment }) => {
      const id = "bind-clove-smoke-contest";
      respondWith(getPublicAnswer(id, { optionId }));
      expect(await submitAnswer(id, { optionId })).toMatchObject({
        matchesPro,
        selectedAssessment: assessment,
        recommendedOptionIds: [],
      });
    },
  );
});

type DetailMutation = {
  name: string;
  mutate: (detail: ReturnType<typeof vodDetail>) => unknown;
};

const invalidDetails: DetailMutation[] = [
  {
    name: "negative setup start",
    mutate: (d) => ({ ...d, setup: { ...d.setup, startSeconds: -1 } }),
  },
  {
    name: "reversed setup bounds",
    mutate: (d) => ({
      ...d,
      setup: { ...d.setup, endSeconds: d.setup.startSeconds - 1 },
    }),
  },
  {
    name: "zero-length setup",
    mutate: (d) => ({
      ...d,
      setup: { ...d.setup, endSeconds: d.setup.startSeconds },
    }),
  },
  {
    name: "non-numeric setup end",
    mutate: (d) => ({ ...d, setup: { ...d.setup, endSeconds: "1713" } }),
  },
  {
    name: "invalid YouTube video ID",
    mutate: (d) => ({ ...d, setup: { ...d.setup, videoId: "invalid" } }),
  },
  { name: "missing source", mutate: (d) => ({ ...d, source: undefined }) },
  {
    name: "non-YouTube attribution URL",
    mutate: (d) => ({
      ...d,
      source: {
        ...d.source,
        url: `https://example.com/watch?v=${d.source.videoId}`,
      },
    }),
  },
  {
    name: "source URL for another video",
    mutate: (d) => ({
      ...d,
      source: {
        ...d.source,
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      },
    }),
  },
  {
    name: "source differs from setup video",
    mutate: (d) => ({
      ...d,
      source: {
        ...d.source,
        videoId: "abcdefghijk",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
      },
    }),
  },
  {
    name: "invalid source round",
    mutate: (d) => ({ ...d, source: { ...d.source, round: 0 } }),
  },
  {
    name: "unsupported source match type",
    mutate: (d) => ({ ...d, source: { ...d.source, matchType: "scrim" } }),
  },
  {
    name: "pause differs from setup end",
    mutate: (d) => ({
      ...d,
      decision: { ...d.decision, atSeconds: d.setup.endSeconds + 1 },
    }),
  },
  {
    name: "negative pause time",
    mutate: (d) => ({ ...d, decision: { ...d.decision, atSeconds: -1 } }),
  },
  {
    name: "image decision attached to VOD",
    mutate: (d) => ({
      ...d,
      decision: { kind: "image", imageUrl: "/frame.svg", alt: "Frame" },
    }),
  },
  {
    name: "missing decision question",
    mutate: (d) => ({ ...d, question: undefined }),
  },
  {
    name: "missing visible evidence",
    mutate: (d) => ({ ...d, knownFacts: [] }),
  },
  {
    name: "missing information limits",
    mutate: (d) => ({ ...d, unknowns: undefined }),
  },
];

describe("malformed VOD challenge responses", () => {
  it.each(invalidDetails)("rejects $name", async ({ mutate }) => {
    respondWith(mutate(vodDetail()));
    await expect(getChallenge(firstId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

type AnswerMutation = {
  name: string;
  mutate: (answer: ReturnType<typeof vodAnswer>) => unknown;
};

const invalidAnswers: AnswerMutation[] = [
  {
    name: "negative reveal start",
    mutate: (a) => ({ ...a, reveal: { ...a.reveal, startSeconds: -1 } }),
  },
  {
    name: "reversed reveal bounds",
    mutate: (a) => ({
      ...a,
      reveal: { ...a.reveal, endSeconds: a.reveal.startSeconds - 1 },
    }),
  },
  {
    name: "missing observed action",
    mutate: (a) => ({ ...a, observedAction: undefined }),
  },
  {
    name: "unknown observed option",
    mutate: (a) => ({
      ...a,
      observedAction: { ...a.observedAction, optionId: "not-an-option" },
    }),
  },
  {
    name: "blank observed action",
    mutate: (a) => ({
      ...a,
      observedAction: { ...a.observedAction, description: " " },
    }),
  },
  {
    name: "missing match flag",
    mutate: (a) => ({ ...a, matchesPro: undefined }),
  },
  {
    name: "non-boolean match flag",
    mutate: (a) => ({ ...a, matchesPro: "true" }),
  },
  {
    name: "match flag contradicts observed option",
    mutate: (a) => ({ ...a, matchesPro: !a.matchesPro }),
  },
  {
    name: "missing AI analysis",
    mutate: (a) => ({ ...a, analysis: undefined }),
  },
  {
    name: "unsupported analysis author",
    mutate: (a) => ({ ...a, analysis: { ...a.analysis, author: "pro" } }),
  },
  {
    name: "blank analysis notice",
    mutate: (a) => ({ ...a, analysis: { ...a.analysis, notice: " " } }),
  },
  {
    name: "blank analysis rationale",
    mutate: (a) => ({ ...a, analysis: { ...a.analysis, rationale: " " } }),
  },
  {
    name: "invalid analysis limitations",
    mutate: (a) => ({
      ...a,
      analysis: { ...a.analysis, limitations: "Not verified" },
    }),
  },
  {
    name: "missing conditional explanation",
    mutate: (a) => ({
      ...a,
      optionFeedback: a.optionFeedback.map((f, i) =>
        i === 0 ? { ...f, acceptableWhen: undefined } : f,
      ),
    }),
  },
  {
    name: "malformed risk explanation",
    mutate: (a) => ({
      ...a,
      optionFeedback: a.optionFeedback.map((f, i) =>
        i === 0 ? { ...f, risks: [null] } : f,
      ),
    }),
  },
  {
    name: "forced recommendation without matching assessment",
    mutate: (a) => ({ ...a, recommendedOptionIds: [a.selectedOptionId] }),
  },
];

describe("malformed VOD answer responses", () => {
  it.each(invalidAnswers)("rejects $name", async ({ mutate }) => {
    const answer = vodAnswer();
    respondWith(mutate(answer));
    await expect(
      submitAnswer(answer.challengeId, { optionId: answer.selectedOptionId }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

const mismatchedAnswers: Array<{
  name: string;
  mutate: (answer: ReturnType<typeof vodAnswer>) => AnswerResponse;
}> = [
  {
    name: "another challenge",
    mutate: (a) => ({ ...a, challengeId: "another-challenge" }),
  },
  {
    name: "different content version",
    mutate: (a) => ({ ...a, contentVersion: "vod-2" }),
  },
  {
    name: "another reveal video",
    mutate: (a) => ({ ...a, reveal: { ...a.reveal, videoId: "abcdefghijk" } }),
  },
  {
    name: "reveal starting after the decision",
    mutate: (a) => ({
      ...a,
      reveal: { ...a.reveal, startSeconds: a.reveal.startSeconds + 0.5 },
    }),
  },
  {
    name: "missing option feedback",
    mutate: (a) => ({ ...a, optionFeedback: a.optionFeedback.slice(1) }),
  },
  {
    name: "feedback for an unrelated option",
    mutate: (a) => ({
      ...a,
      optionFeedback: a.optionFeedback.map((f, i) =>
        i === 1 ? { ...f, optionId: "another-option" } : f,
      ),
    }),
  },
  {
    name: "unrelated observed option",
    mutate: (a) => ({
      ...a,
      observedAction: { ...a.observedAction, optionId: "another-option" },
    }),
  },
  {
    name: "illustration replacing VOD continuation",
    mutate: (a) => ({
      ...a,
      reveal: { kind: "illustration", src: "/outcome.svg", alt: "Outcome" },
    }),
  },
];

describe("answer validation against the displayed VOD", () => {
  it.each(mismatchedAnswers)("rejects $name", ({ mutate }) => {
    const detail: ChallengeDetail = vodDetail();
    expect(() =>
      validateAnswerForChallenge(mutate(vodAnswer()), detail),
    ).toThrow(ChallengeApiError);
  });
});
