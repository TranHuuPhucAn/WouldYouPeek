import { describe, expect, it } from "vitest";
import {
  parseChallengeDetail,
  parseChallengePreview,
  parseAnswerResponse,
  validateAnswerForChallenge,
} from "@/lib/client/challenge-validation";
import { creatorPreview } from "./creator-fixtures";
import { VIDEO_ID } from "./video-fixtures";
import type { ChallengeDetail, AnswerResponse } from "@/contracts/challenge";
function sample() {
  const p = creatorPreview();
  const source = p.challenge.source!;
  const {
    kind: _kind,
    videoId: _videoId,
    url: _url,
    ...credit
  } = source as Extract<typeof source, { kind: "youtube" }>;
  const setup = p.challenge.setup as Extract<
    typeof p.challenge.setup,
    { kind: "youtube" }
  >;
  const challenge: ChallengeDetail = {
    ...p.challenge,
    source: { ...credit, kind: "uploaded", assetId: VIDEO_ID, creditUrl: "" },
    setup: {
      kind: "uploaded-video",
      assetId: VIDEO_ID,
      startSeconds: setup.startSeconds,
      endSeconds: setup.endSeconds,
      alt: setup.alt,
    },
  };
  const a = Object.values(p.feedbackByOption)[0];
  const reveal = a.reveal as Extract<typeof a.reveal, { kind: "youtube" }>;
  const answer: AnswerResponse = {
    ...a,
    reveal: {
      kind: "uploaded-video",
      assetId: VIDEO_ID,
      startSeconds: reveal.startSeconds,
      endSeconds: reveal.endSeconds,
      alt: reveal.alt,
    },
  };
  return { challenge, answer };
}
describe("uploaded immutable challenge validation", () => {
  it("accepts saved setup and reveal without embedding capabilities", () => {
    const { challenge, answer } = sample();
    expect(parseChallengeDetail(challenge)).toEqual(challenge);
    expect(parseAnswerResponse(answer)).toEqual(answer);
    expect(() => validateAnswerForChallenge(answer, challenge)).not.toThrow();
    const { id, title, topic, order, mediaStatus, context, source, setup } =
      challenge;
    expect(
      parseChallengePreview({
        id,
        title,
        topic,
        order,
        mediaStatus,
        context,
        source,
        setup,
      }),
    ).toMatchObject({ setup });
  });
  it("rejects mixed source identities, leaked playback URLs and mismatched continuations", () => {
    const { challenge, answer } = sample();
    expect(() =>
      parseChallengeDetail({
        ...challenge,
        source: creatorPreview().challenge.source,
      }),
    ).toThrow();
    expect(() =>
      parseChallengeDetail({
        ...challenge,
        setup: { ...challenge.setup, url: "secret" },
      }),
    ).toThrow();
    expect(() =>
      parseAnswerResponse({ ...answer, analysis: undefined }),
    ).toThrow();
    expect(() =>
      validateAnswerForChallenge(
        {
          ...answer,
          reveal: {
            ...answer.reveal,
            assetId: "82300000-0000-4000-8000-000000000099",
          } as typeof answer.reveal,
        },
        challenge,
      ),
    ).toThrow();
  });
});
