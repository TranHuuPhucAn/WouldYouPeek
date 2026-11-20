import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AnswerResponse, ChallengeDetail } from "@/contracts/challenge";
import { FeedbackPanel } from "@/components/challenge/FeedbackPanel";
import { ReviewControls } from "@/components/challenge/ReviewControls";
import { SessionRecap } from "@/components/challenge/SessionRecap";

const challenge: ChallengeDetail = {
  id: "smoke-contest",
  title: "Contest the smoke",
  topic: "Risk and support",
  order: 1,
  mediaStatus: "ready",
  contentVersion: "vod-1",
  context: "You have 35 HP and the team is down a player.",
  setup: {
    kind: "youtube",
    videoId: "_yPrykaB2nE",
    startSeconds: 1885,
    endSeconds: 1889.5,
    alt: "A Short setup",
  },
  decision: {
    kind: "paused-video",
    atSeconds: 1889.5,
    alt: "The smoke decision",
  },
  source: {
    kind: "youtube",
    videoId: "_yPrykaB2nE",
    url: "https://www.youtube.com/watch?v=_yPrykaB2nE",
    title: "Ranked stream",
    uploader: "TenZ",
    player: "TenZ",
    matchType: "ranked",
    map: "Bind",
    agent: "Clove",
    round: 13,
    score: "9–3",
    side: "defense",
  },
  options: [
    { id: "hold", label: "Hold the smoke exit" },
    { id: "peek", label: "Contest A Short" },
    { id: "reset", label: "Regroup with support" },
  ],
};

function makeAnswer(selectedOptionId = "hold"): AnswerResponse {
  return {
    challengeId: challenge.id,
    contentVersion: challenge.contentVersion,
    selectedOptionId,
    selectedAssessment: selectedOptionId === "peek" ? "risky" : "reasonable",
    recommendedOptionIds: [],
    optionFeedback: [
      {
        optionId: "hold",
        assessment: "reasonable",
        explanation: "Holding can preserve a close contact.",
        acceptableWhen: ["A teammate can trade the contact."],
        risks: ["The attackers may take another route."],
      },
      {
        optionId: "peek",
        assessment: "risky",
        explanation: "The exposure depends on timing.",
        acceptableWhen: ["The close fight is isolated."],
        risks: ["Low health leaves little room for error."],
      },
      {
        optionId: "reset",
        assessment: "reasonable",
        explanation: "A reset can improve support.",
        acceptableWhen: ["The route preserves site control."],
        risks: ["Moving can concede space."],
      },
    ],
    takeaway: "Reassess risk when the numbers change.",
    reveal: {
      kind: "youtube",
      videoId: "_yPrykaB2nE",
      startSeconds: 1889.5,
      endSeconds: 1897,
      alt: "The observed continuation",
    },
    outcomeText: "TenZ wins the close fight and backs away.",
    observedAction: {
      optionId: "peek",
      description: "Contests A Short, then reloads behind the smoke.",
    },
    matchesPro: selectedOptionId === "peek",
    analysis: {
      author: "ai",
      notice: "This is an interpretation of the available footage.",
      rationale: "Being down a player can justify a conditional risk.",
      limitations: ["Complete team communications are unavailable."],
    },
  };
}

function renderFeedback(answer = makeAnswer(), detail = challenge) {
  const onShowSetup = vi.fn();
  const onShowOutcome = vi.fn();
  const onNext = vi.fn();
  render(
    <>
      <FeedbackPanel challenge={detail} answer={answer} />
      <ReviewControls
        analysisVisible
        status="complete"
        analysisId="analysis"
        reviewMedia="outcome"
        onShowSetup={onShowSetup}
        onShowOutcome={onShowOutcome}
        onNext={onNext}
        onShowAnalysis={vi.fn()}
        onViewAnalysis={vi.fn()}
        nextLabel="Finish session"
      />
    </>,
  );
  return { onShowSetup, onShowOutcome, onNext };
}

describe("conditional pro feedback", () => {
  it("separates a different pro choice from a defensible assessment", async () => {
    const user = userEvent.setup();
    renderFeedback();
    expect(screen.getByText(/Different choice from the pro/)).toBeVisible();
    expect(screen.getAllByText(/Defensible/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/There is no single preferred answer here/),
    ).toBeVisible();
    await user.click(screen.getByText("Conditions & risks"));
    expect(screen.getByText("A teammate can trade the contact.")).toBeVisible();
    await user.click(screen.getByText("Other choices"));
    expect(
      screen.getByText("Low health leaves little room for error."),
    ).toBeVisible();
    await user.click(screen.getByText("Deeper reasoning & limitations"));
    const analysis = screen.getByRole("region", { name: "AI analysis" });
    expect(
      within(analysis).getByText(
        "This is an interpretation of the available footage.",
      ),
    ).toBeVisible();
    await user.click(within(analysis).getByText("What remains uncertain"));
    expect(
      within(analysis).getByText(
        "Complete team communications are unavailable.",
      ),
    ).toBeVisible();
  });

  it("shows a matched choice as risky without presenting the result as correctness", async () => {
    renderFeedback(makeAnswer("peek"));
    expect(screen.getByText(/Same choice as the pro/)).toBeVisible();
    expect(screen.getByText("Your decision: Risky")).toBeVisible();
    expect(screen.queryByText(/correct answer/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Recorded outcome"));
    expect(
      screen.getByText(/A successful outcome does not settle the quality/),
    ).toBeVisible();
  });

  it("retains authored continuation language without inventing pro comparison for legacy media", () => {
    const answer = makeAnswer();
    delete answer.observedAction;
    delete answer.matchesPro;
    delete answer.analysis;
    answer.reveal = {
      kind: "illustration",
      src: "/demo/reveal.svg",
      alt: "Authored outcome",
    };
    const demo: ChallengeDetail = {
      ...challenge,
      mediaStatus: "demo",
      source: undefined,
      setup: { kind: "illustration", src: "/demo/setup.svg", alt: "Setup" },
      decision: {
        kind: "image",
        imageUrl: "/demo/decision.svg",
        alt: "Decision",
      },
    };
    renderFeedback(answer, demo);
    expect(screen.getByText("Authored continuation")).toBeVisible();
    expect(screen.queryByText(/choice.*the pro/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "AI analysis" }),
    ).not.toBeInTheDocument();
  });

  it("keeps setup/outcome review and final-session controls connected", async () => {
    const user = userEvent.setup();
    const controls = renderFeedback();
    await user.click(screen.getByRole("button", { name: "Watch setup" }));
    await user.click(
      screen.getByRole("button", { name: "Watch continuation" }),
    );
    await user.click(screen.getByRole("button", { name: /Finish session/ }));
    expect(controls.onShowSetup).toHaveBeenCalledOnce();
    expect(controls.onShowOutcome).toHaveBeenCalledOnce();
    expect(controls.onNext).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Watch continuation" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("VOD session recap", () => {
  it("retains source, comparison and assessment independently and expands conditional reasoning", async () => {
    const user = userEvent.setup();
    const onRestart = vi.fn();
    render(
      <SessionRecap
        items={[
          {
            id: "saved-item",
            position: 0,
            challenge,
            answer: {
              id: "saved-answer",
              answeredAt: "2026-11-21T00:00:00Z",
              result: makeAnswer("peek"),
            },
          },
        ]}
        sessionId="saved-session"
        viewerId="learner"
        onRestart={onRestart}
      />,
    );
    expect(screen.getByText("TenZ · Bind · Round 13")).toBeVisible();
    expect(screen.getByText("Same choice as the pro")).toBeVisible();
    const card = screen.getByText(challenge.title).closest("details")!;
    expect(
      within(card.querySelector("summary")!).getByText("Risky"),
    ).toBeVisible();
    await user.click(screen.getByText(challenge.title));
    await user.click(within(card).getByText("Deeper reasoning & limitations"));
    await user.click(within(card).getByText("Conditions & risks"));
    expect(
      within(card).getByText(
        "Being down a player can justify a conditional risk.",
      ),
    ).toBeVisible();
    expect(within(card).getByText(/The close fight is isolated/)).toBeVisible();
    expect(
      screen.queryByText(/illustrative scenarios/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/accuracy/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Play again/ }));
    expect(onRestart).toHaveBeenCalledOnce();
  });
});
