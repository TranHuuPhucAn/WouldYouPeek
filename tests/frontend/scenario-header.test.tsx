import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  ScenarioHeader,
  type ScenarioPhase,
} from "@/components/challenge/ScenarioHeader";
import { getChallenge } from "../fixtures/authored-challenges";
import { challenges } from "./fixtures";

vi.mock("server-only", () => ({}));

it("uses the actual single-item or playlist count and retains saved credit", () => {
  const challenge = getChallenge("bind-clove-smoke-contest");
  const { rerender } = render(
    <ScenarioHeader challenge={challenge} phase="setup" index={0} total={1} />,
  );
  expect(screen.getByLabelText("Scenario 1 of 1")).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 1, name: challenge.title }),
  ).toBeVisible();
  expect(
    screen.getByText(/TenZ \/ Bind \/ Clove \/ Round 13 \/ Defense \/ 9–3/),
  ).toBeVisible();
  rerender(
    <ScenarioHeader
      challenge={challenge}
      phase="analysis"
      index={11}
      total={20}
      title="Saved mixed-player sequence"
      playlist={{
        publicationVersion: "saved-v1",
        credit: { kind: "creator", displayName: "Original creator credit" },
        players: [],
      }}
    />,
  );
  expect(screen.getByLabelText("Scenario 12 of 20")).toBeVisible();
  expect(screen.getByText(/Original creator credit/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute(
    "href",
    "/library",
  );
});

it.each<[ScenarioPhase, string, string]>([
  ["setup", "Watch the setup", "Watch"],
  ["decision", "Decision paused", "Decide"],
  ["saving", "Saving your choice", "Decide"],
  ["continuation", "Watch the continuation", "Review"],
  ["analysis", "Review the analysis", "Review"],
])("announces %s without an outcome or assessment", (phase, label, step) => {
  render(
    <ScenarioHeader
      challenge={getChallenge("bind-clove-smoke-contest")}
      phase={phase}
      index={1}
      total={3}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(label);
  const steps = screen.getByRole("list", { name: label });
  expect(steps.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent(step);
  expect(
    screen.queryByText(/Your decision:|OBSERVED CHOICE|THE TAKEAWAY/),
  ).not.toBeInTheDocument();
});

it("uses a subordinate preview heading and preserves missing-source fallback metadata", () => {
  render(<ScenarioHeader challenge={challenges[0]} phase="setup" preview />);
  expect(
    screen.getByRole("heading", { level: 2, name: challenges[0].title }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  expect(screen.getByText(challenges[0].topic)).toBeVisible();
  expect(screen.queryByText(/Scenario \d+ of/)).not.toBeInTheDocument();
});
