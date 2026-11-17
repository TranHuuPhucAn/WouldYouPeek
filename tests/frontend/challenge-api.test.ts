import { describe, expect, it, vi } from "vitest";
import {
  ChallengeApiError,
  getChallenge,
  getChallenges,
  submitAnswer,
} from "@/lib/client/challenge-api";
import { answerFor, challenges, summaries } from "./fixtures";

describe("challenge API adapter", () => {
  it("unwraps the catalogue and forwards the cancellation signal", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ challenges: summaries }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    expect(await getChallenges(controller.signal)).toEqual(summaries);
    expect(fetcher).toHaveBeenCalledWith("/api/challenges", {
      signal: controller.signal,
      cache: "no-store",
    });
  });
  it("encodes challenge IDs and checks that the response belongs to the request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ ...challenges[0], id: "a/b" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await getChallenge("a/b")).id).toBe("a/b");
    expect(fetcher.mock.calls[0][0]).toBe("/api/challenges/a%2Fb");
  });
  it("posts only the selected option and returns feedback", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(answerFor()));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await submitAnswer(challenges[0].id, { optionId: "hold" }))
        .selectedAssessment,
    ).toBe("recommended");
    expect(fetcher).toHaveBeenCalledWith(
      `/api/challenges/${challenges[0].id}/answer`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"optionId":"hold"}',
      }),
    );
  });
  it.each([400, 404, 500])(
    "preserves a structured %i error",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json(
            {
              error: {
                code: "CHALLENGE_NOT_FOUND",
                message: "Scenario missing.",
              },
            },
            { status },
          ),
        ),
      );
      await expect(getChallenge("missing")).rejects.toMatchObject({
        name: "ChallengeApiError",
        code: "CHALLENGE_NOT_FOUND",
        message: "Scenario missing.",
        status,
      });
    },
  );
  it("gives readable errors for non-JSON and unstructured failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
        .mockResolvedValueOnce(Response.json({}, { status: 500 })),
    );
    await expect(getChallenges()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    });
    await expect(getChallenges()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      status: 500,
    });
  });
  it("preserves network errors and cancellation", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    const network = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(abort).mockRejectedValueOnce(network),
    );
    await expect(getChallenges()).rejects.toBe(abort);
    await expect(getChallenges()).rejects.toBe(network);
  });
  it.each([
    {},
    { challenges: [] },
    { challenges: [{ id: "bad" }] },
    { challenges: [summaries[0], summaries[0]] },
  ])("rejects malformed successful catalogues", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(getChallenges()).rejects.toBeInstanceOf(ChallengeApiError);
  });
  it.each([
    {},
    { ...challenges[0], id: "wrong" },
    { ...challenges[0], options: [] },
    { ...challenges[0], setup: {} },
    { ...challenges[0], decision: null },
  ])("rejects malformed successful challenge responses", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(getChallenge(challenges[0].id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it.each([
    {},
    { ...answerFor(), challengeId: "wrong" },
    { ...answerFor(), selectedOptionId: "peek" },
    { ...answerFor(), optionFeedback: [] },
    { ...answerFor(), reveal: null },
  ])("rejects malformed successful answer responses", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(
      submitAnswer(challenges[0].id, { optionId: "hold" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
