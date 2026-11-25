import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ScenarioContext } from "@/components/challenge/ScenarioContext";
import { getChallenge } from "../fixtures/authored-challenges";
import { challenges } from "./fixtures";

vi.mock("server-only", () => ({}));

it("retains all player-known facts and reveals optional unknowns through a native disclosure", async () => {
  const user = userEvent.setup();
  const challenge = getChallenge("bind-clove-smoke-contest");
  render(<ScenarioContext challenge={challenge} />);
  expect(screen.getByText(challenge.context)).toBeVisible();
  for (const fact of challenge.knownFacts!)
    expect(screen.getByText(fact)).toBeVisible();
  for (const unknown of challenge.unknowns!)
    expect(screen.getByText(unknown)).not.toBeVisible();
  await user.click(screen.getByText("What remains unknown"));
  for (const unknown of challenge.unknowns!)
    expect(screen.getByText(unknown)).toBeVisible();
});

it("keeps full source attribution and its spoiler warning reachable", async () => {
  const user = userEvent.setup();
  const challenge = getChallenge("bind-clove-smoke-contest");
  render(<ScenarioContext challenge={challenge} />);
  await user.click(screen.getByText("Source & attribution"));
  expect(screen.getByRole("link", { name: /Source: TenZ/ })).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=_yPrykaB2nE",
  );
  expect(
    screen.getByText(/Opening the source can reveal the outcome/),
  ).toBeVisible();
  expect(screen.getByText(/Ranked player recording/)).toBeVisible();
});

it("identifies legacy illustrations honestly without inventing source or unknown details", () => {
  render(
    <ScenarioContext
      challenge={{ ...challenges[0], linkedScenarioId: "next-saved-scenario" }}
    />,
  );
  expect(screen.getByText(/Not recorded Valorant footage/)).toBeVisible();
  expect(screen.getByText(/Linked follow-up/)).toBeVisible();
  expect(screen.queryByText("Source & attribution")).not.toBeInTheDocument();
  expect(screen.queryByText("What remains unknown")).not.toBeInTheDocument();
});
