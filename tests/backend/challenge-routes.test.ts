import { describe, expect, it } from "vitest";
import { GET as getList } from "@/app/api/challenges/route";
import { GET as getDetail } from "@/app/api/challenges/[id]/route";
import { POST as postAnswer } from "@/app/api/challenges/[id]/answer/route";

function createAnswerRequest(body: unknown): Request {
  return new Request(
    "http://localhost/api/challenges/bind-clove-utility-window/answer",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function createRouteContext(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function readResponseJson(response: Response) {
  return response.json();
}

describe("challenge route handlers", () => {
  it("returns the three-item catalogue wrapper", async () => {
    const response = await getList();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await readResponseJson(response);
    expect(Object.keys(body)).toEqual(["challenges"]);
    expect(body.challenges.map((item: { id: string }) => item.id)).toEqual([
      "bind-clove-utility-window",
      "bind-clove-smoke-contest",
      "bind-clove-advantage-reset",
    ]);
  });

  it.each([
    ["bind-clove-utility-window", "use-meddle", "reasonable"],
    ["bind-clove-smoke-contest", "contest-short", "risky"],
    ["bind-clove-advantage-reset", "clear-forward", "reasonable"],
  ])(
    "returns safe detail and complete answer for %s",
    async (id, optionId, assessment) => {
      const detailResponse = await getDetail(
        new Request("http://localhost/api"),
        createRouteContext(id),
      );
      expect(detailResponse.status).toBe(200);
      const detail = await readResponseJson(detailResponse);
      expect(detail.id).toBe(id);
      expect(detail.contentVersion).toBe("vod-1");
      expect(detail.setup.kind).toBe("youtube");
      expect(detail.decision.kind).toBe("paused-video");
      expect(detail.source.player).toBe("TenZ");
      expect(detail.knownFacts.length).toBeGreaterThan(0);
      expect(detail.unknowns.length).toBeGreaterThan(0);
      for (const field of [
        "reveal",
        "optionFeedback",
        "observedAction",
        "matchesPro",
        "analysis",
        "review",
        "outcomeText",
        "recommendedOptionIds",
      ])
        expect(detail).not.toHaveProperty(field);
      expect(
        detail.options.every(
          (option: object) => Object.keys(option).length === 2,
        ),
      ).toBe(true);
      const response = await postAnswer(
        createAnswerRequest({ optionId }),
        createRouteContext(id),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      const answer = await readResponseJson(response);
      expect(answer.selectedAssessment).toBe(assessment);
      expect(answer.matchesPro).toBe(true);
      expect(answer.observedAction.optionId).toBe(optionId);
      expect(answer.analysis.author).toBe("ai");
      expect(answer.recommendedOptionIds).toEqual([]);
      expect(answer.challengeId).toBe(id);
      expect(answer.contentVersion).toBe(detail.contentVersion);
      expect(answer.optionFeedback).toHaveLength(3);
      expect(answer.reveal.kind).toBe("youtube");
      expect(answer.reveal.videoId).toBe(detail.setup.videoId);
      expect(answer.reveal.startSeconds).toBe(detail.decision.atSeconds);
      expect(answer.reveal.endSeconds).toBeGreaterThan(
        answer.reveal.startSeconds,
      );
      expect(
        answer.optionFeedback.every(
          (item: { acceptableWhen: string[]; risks: string[] }) =>
            item.acceptableWhen.length > 0 && item.risks.length > 0,
        ),
      ).toBe(true);
    },
  );

  it("returns 404 from detail and answer routes for missing challenges", async () => {
    for (const response of [
      await getDetail(
        new Request("http://localhost/api"),
        createRouteContext("missing"),
      ),
      await postAnswer(
        createAnswerRequest({ optionId: "hold" }),
        createRouteContext("missing"),
      ),
    ]) {
      expect(response.status).toBe(404);
      expect((await readResponseJson(response)).error.code).toBe(
        "CHALLENGE_NOT_FOUND",
      );
    }
  });

  it("returns 400 for malformed JSON", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "{",
    });
    const response = await postAnswer(
      request,
      createRouteContext("bind-clove-utility-window"),
    );
    expect(response.status).toBe(400);
    expect((await readResponseJson(response)).error.code).toBe("INVALID_JSON");
  });

  it.each([
    null,
    [],
    {},
    { optionId: "" },
    { optionId: 4 },
    { optionId: "hold", extra: true },
  ])("returns 400 for invalid answer shape %#", async (body) => {
    const response = await postAnswer(
      createAnswerRequest(body),
      createRouteContext("bind-clove-utility-window"),
    );
    expect(response.status).toBe(400);
    expect((await readResponseJson(response)).error.code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("returns 400 for an option not in this challenge", async () => {
    const response = await postAnswer(
      createAnswerRequest({ optionId: "trade" }),
      createRouteContext("bind-clove-utility-window"),
    );
    expect(response.status).toBe(400);
    expect((await readResponseJson(response)).error.code).toBe(
      "INVALID_OPTION",
    );
  });

  it("returns a defensible nonmatching answer without changing the observed pro action", async () => {
    const response = await postAnswer(
      createAnswerRequest({ optionId: "hold-exit" }),
      createRouteContext("bind-clove-smoke-contest"),
    );
    expect(response.status).toBe(200);
    expect(await readResponseJson(response)).toMatchObject({
      selectedOptionId: "hold-exit",
      selectedAssessment: "reasonable",
      observedAction: { optionId: "contest-short" },
      matchesPro: false,
    });
  });
});
