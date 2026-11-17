import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHALLENGES } from "@/server/challenges/data";

describe("curated VOD challenge integrity", () => {
  it("ships the three approved moments in order with their reviewed bounds", () => {
    expect(
      CHALLENGES.map(({ id, order, setup, decision, reveal }) => ({
        id,
        order,
        bounds: [setup.startSeconds, decision.atSeconds, reveal.endSeconds],
      })),
    ).toEqual([
      {
        id: "bind-clove-utility-window",
        order: 1,
        bounds: [1705, 1713, 1718],
      },
      {
        id: "bind-clove-smoke-contest",
        order: 2,
        bounds: [1885, 1889.5, 1897],
      },
      {
        id: "bind-clove-advantage-reset",
        order: 3,
        bounds: [1903, 1913, 1920.5],
      },
    ]);
    expect(new Set(CHALLENGES.map(({ id }) => id)).size).toBe(3);
  });

  it.each(CHALLENGES)(
    "has consistent source and segment boundaries: $id",
    (challenge) => {
      expect(challenge.mediaStatus).toBe("ready");
      expect(challenge.source).toMatchObject({
        kind: "youtube",
        videoId: "_yPrykaB2nE",
        url: "https://www.youtube.com/watch?v=_yPrykaB2nE",
        uploader: "TenZ",
        player: "TenZ",
        map: "Bind",
        agent: "Clove",
        matchType: "ranked",
      });
      expect(challenge.source.round).toBeGreaterThan(0);
      expect(Number.isInteger(challenge.source.round)).toBe(true);
      expect(["attack", "defense"]).toContain(challenge.source.side);
      expect(challenge.setup.kind).toBe("youtube");
      expect(challenge.reveal.kind).toBe("youtube");
      expect(challenge.decision.kind).toBe("paused-video");
      expect(challenge.setup.videoId).toBe(challenge.source.videoId);
      expect(challenge.reveal.videoId).toBe(challenge.setup.videoId);
      expect(challenge.setup.endSeconds).toBe(challenge.decision.atSeconds);
      expect(challenge.reveal.startSeconds).toBe(challenge.decision.atSeconds);
      for (const time of [
        challenge.setup.startSeconds,
        challenge.setup.endSeconds,
        challenge.decision.atSeconds,
        challenge.reveal.startSeconds,
        challenge.reveal.endSeconds,
      ]) {
        expect(Number.isFinite(time)).toBe(true);
        expect(time).toBeGreaterThanOrEqual(0);
      }
      expect(challenge.setup.startSeconds).toBeLessThan(
        challenge.decision.atSeconds,
      );
      expect(challenge.decision.atSeconds).toBeLessThan(
        challenge.reveal.endSeconds,
      );
    },
  );

  it.each(CHALLENGES)(
    "has complete conditional feedback and review evidence: $id",
    (challenge) => {
      expect(challenge.options).toHaveLength(3);
      const optionIds = challenge.options.map(({ id }) => id);
      expect(new Set(optionIds).size).toBe(3);
      expect(optionIds).toContain(challenge.observedAction.optionId);
      expect(challenge.analysis.author).toBe("ai");
      expect(challenge.analysis.notice).toContain("interpretation");
      expect(challenge.analysis.limitations.length).toBeGreaterThan(0);
      expect(challenge.knownFacts.length).toBeGreaterThan(0);
      expect(challenge.unknowns.length).toBeGreaterThan(0);
      for (const option of challenge.options) {
        expect(["recommended", "reasonable", "risky"]).toContain(
          option.assessment,
        );
        expect(option.acceptableWhen.length).toBeGreaterThan(0);
        expect(option.risks.length).toBeGreaterThan(0);
        for (const text of [
          option.label,
          option.explanation,
          ...option.acceptableWhen,
          ...option.risks,
        ])
          expect(text.trim().length).toBeGreaterThan(0);
      }
      for (const text of [
        challenge.title,
        challenge.question,
        challenge.context,
        challenge.contentVersion,
        challenge.takeaway,
        challenge.outcomeText,
        challenge.observedAction.description,
        challenge.analysis.rationale,
        challenge.setup.alt,
        challenge.decision.alt,
        challenge.reveal.alt,
        ...challenge.knownFacts,
        ...challenge.unknowns,
        ...challenge.analysis.limitations,
      ])
        expect(text.trim().length).toBeGreaterThan(0);

      expect(challenge.review.reviewedBy).toBe("assistant");
      expect(challenge.review.visual).toBe("verified");
      expect(["pending", "verified"]).toContain(challenge.review.audio);
      expect(["pending", "verified"]).toContain(challenge.review.embed);
      expect(challenge.review.evidence.length).toBeGreaterThan(0);
      for (const evidence of challenge.review.evidence)
        expect(existsSync(resolve(process.cwd(), evidence))).toBe(true);
    },
  );

  it("permits ambiguous scenarios without inventing a uniquely recommended choice", () => {
    for (const id of [
      "bind-clove-utility-window",
      "bind-clove-advantage-reset",
    ]) {
      const challenge = CHALLENGES.find((entry) => entry.id === id)!;
      expect(
        challenge.options.filter(
          ({ assessment }) => assessment === "recommended",
        ),
      ).toEqual([]);
      expect(
        challenge.options.filter(
          ({ assessment }) => assessment === "reasonable",
        ).length,
      ).toBeGreaterThan(1);
    }
  });

  it("links the advantage follow-up to an earlier scenario from the same source and round", () => {
    const followUp = CHALLENGES[2];
    const previous = CHALLENGES.find(
      ({ id }) => id === followUp.linkedScenarioId,
    );
    expect(previous).toBeDefined();
    expect(previous!.order).toBeLessThan(followUp.order);
    expect(previous!.source.videoId).toBe(followUp.source.videoId);
    expect(previous!.source.round).toBe(followUp.source.round);
    expect(previous!.reveal.endSeconds).toBeLessThan(
      followUp.setup.startSeconds,
    );
  });
});
