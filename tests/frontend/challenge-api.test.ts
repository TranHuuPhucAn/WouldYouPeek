import { describe, expect, it, vi } from "vitest";
import {
  getChallenges,
  getChallengePreview,
  ChallengeApiError,
} from "@/lib/client/challenge-api";
import {
  parseChallengeDetail,
  parseAnswerResponse,
  validateAnswerForChallenge,
} from "@/lib/client/challenge-validation";
import { challenges, answerFor } from "./fixtures";
const { id, title, topic, order, mediaStatus, context, setup } = challenges[0];
const preview = { id, title, topic, order, mediaStatus, context, setup };
describe("public previews and response validation", () => {
  it("loads only setup preview fields with no caching", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ challenges: [preview] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await getChallenges()).toEqual([preview]);
    expect(fetcher).toHaveBeenCalledWith("/api/challenges", {
      cache: "no-store",
      signal: undefined,
    });
  });
  it.each(["question", "options", "reveal", "analysis", "decision"])(
    "rejects a leaked %s field",
    async (field) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(Response.json({ ...preview, [field]: "private" })),
      );
      await expect(getChallengePreview(id)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );
  it("rejects wrong resource, duplicate previews and malformed media", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ ...preview, id: "wrong" }))
        .mockResolvedValueOnce(
          Response.json({ challenges: [preview, preview] }),
        )
        .mockResolvedValueOnce(
          Response.json({ ...preview, setup: { kind: "youtube" } }),
        ),
    );
    await expect(getChallengePreview(id)).rejects.toThrow();
    await expect(getChallenges()).rejects.toThrow();
    await expect(getChallengePreview(id)).rejects.toThrow();
  });
  it.each([401, 403, 409, 429, 503])(
    "retains typed failure status %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { code: "AUTH_REQUIRED", message: "Sign in" } },
              { status },
            ),
          ),
      );
      await expect(getChallenges()).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
        status,
      });
    },
  );
  it("rejects unreadable and primitive JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("invalid"))
        .mockResolvedValueOnce(Response.json(1)),
    );
    await expect(getChallenges()).rejects.toBeInstanceOf(ChallengeApiError);
    await expect(getChallenges()).rejects.toThrow();
  });
  it("preserves abort and network failure", async () => {
    const abort = new DOMException("Abort", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(getChallenges()).rejects.toBe(abort);
  });
  it("validates full saved detail and answer relationship", () => {
    expect(parseChallengeDetail(challenges[0])).toEqual(challenges[0]);
    expect(parseAnswerResponse(answerFor())).toEqual(answerFor());
    expect(() =>
      validateAnswerForChallenge(
        { ...answerFor(), contentVersion: "old" },
        challenges[0],
      ),
    ).toThrow();
  });
});
