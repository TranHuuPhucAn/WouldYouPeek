import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FeedbackPanel } from "@/components/challenge/FeedbackPanel";
import { getChallenge, submitAnswer } from "../fixtures/authored-challenges";
import { answerFor, challenges } from "./fixtures";

vi.mock("server-only", () => ({}));

it("shows the chosen explanation first while preserving expandable alternatives and risks", async () => {
  const user = userEvent.setup();
  const challenge = getChallenge("bind-clove-smoke-contest");
  const answer = submitAnswer(challenge.id, { optionId: "hold-exit" });
  render(<FeedbackPanel challenge={challenge} answer={answer} />);
  const chosen = answer.optionFeedback.find(
    (entry) => entry.optionId === "hold-exit",
  )!;
  expect(screen.getByText(chosen.explanation)).toBeVisible();
  expect(screen.getByText(answer.takeaway)).toBeVisible();
  expect(screen.getByText(chosen.risks[0])).not.toBeVisible();
  await user.click(screen.getByText("Conditions & risks"));
  const selectedConditions = screen
    .getByText("Conditions & risks")
    .closest("details")!;
  expect(
    within(selectedConditions).getByRole("heading", {
      level: 3,
      name: "Defensible when",
    }),
  ).toBeVisible();
  expect(
    within(selectedConditions).getByRole("heading", {
      level: 3,
      name: "Risks to account for",
    }),
  ).toBeVisible();
  expect(screen.getByText(chosen.risks[0])).toBeVisible();
  expect(screen.getByText(chosen.acceptableWhen[0])).toBeVisible();
  await user.click(screen.getByText("Other choices"));
  for (const alternative of answer.optionFeedback.filter(
    (entry) => entry.optionId !== "hold-exit",
  )) {
    expect(screen.getByText(alternative.explanation)).toBeVisible();
    const alternativeCard = screen
      .getByText(alternative.explanation)
      .closest("article")!;
    expect(
      within(alternativeCard).getByRole("heading", { level: 3 }),
    ).toBeVisible();
    expect(
      within(alternativeCard).getByRole("heading", {
        level: 4,
        name: "Defensible when",
      }),
    ).toBeVisible();
    expect(
      within(alternativeCard).getByRole("heading", {
        level: 4,
        name: "Risks to account for",
      }),
    ).toBeVisible();
    for (const condition of alternative.acceptableWhen)
      expect(screen.getByText(condition)).toBeVisible();
    for (const risk of alternative.risks)
      expect(screen.getByText(risk)).toBeVisible();
  }
});

it("separates a risky pro match from a defensible different choice", () => {
  const challenge = getChallenge("bind-clove-smoke-contest");
  const { rerender } = render(
    <FeedbackPanel
      challenge={challenge}
      answer={submitAnswer(challenge.id, { optionId: "contest-short" })}
    />,
  );
  expect(screen.getByText("Your decision: Risky")).toBeVisible();
  expect(screen.getByText(/Same choice as the pro/)).toBeVisible();
  rerender(
    <FeedbackPanel
      challenge={challenge}
      answer={submitAnswer(challenge.id, { optionId: "hold-exit" })}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Different call. Still defensible." }),
  ).toBeVisible();
  expect(screen.getByText("Your decision: Defensible")).toBeVisible();
  expect(screen.getByText(/Different choice from the pro/)).toBeVisible();
  expect(
    screen.getByText(/There is no single preferred answer here/),
  ).toBeVisible();
});

it("keeps interpretation and observed outcome available without presenting them as the pro's intent", async () => {
  const user = userEvent.setup();
  const challenge = getChallenge("bind-clove-smoke-contest");
  const answer = submitAnswer(challenge.id, { optionId: "hold-exit" });
  render(<FeedbackPanel challenge={challenge} answer={answer} />);
  expect(screen.getByText(answer.analysis!.rationale)).not.toBeVisible();
  await user.click(screen.getByText("Deeper reasoning & limitations"));
  expect(screen.getByText(answer.analysis!.rationale)).toBeVisible();
  await user.click(screen.getByText("What remains uncertain"));
  for (const limit of answer.analysis!.limitations)
    expect(screen.getByText(limit)).toBeVisible();
  await user.click(screen.getByText("Recorded outcome"));
  expect(screen.getByText(answer.outcomeText)).toBeVisible();
  expect(screen.getByText(answer.observedAction!.description)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Next|Finish|Watch/ }),
  ).not.toBeInTheDocument();
});

it("reviews an authored legacy answer without inventing a pro comparison", () => {
  render(<FeedbackPanel challenge={challenges[0]} answer={answerFor()} />);
  const panel = screen.getByRole("region", { name: "Answer feedback" });
  expect(within(panel).queryByText("OBSERVED CHOICE")).not.toBeInTheDocument();
  expect(within(panel).getByText("Your decision: recommended")).toBeVisible();
  expect(within(panel).getByText("Authored continuation")).toBeVisible();
});
