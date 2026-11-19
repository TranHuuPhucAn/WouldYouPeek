import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ChallengePlayer } from "@/components/challenge/ChallengePlayer";
import { snapshot, viewer } from "./session-fixtures";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: vi.fn(),
}));
it("starts from owned setup and restores review on refresh", async () => {
  const view = render(
    <ChallengePlayer initialSession={snapshot()} viewer={viewer} />,
  );
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Hold the advantage" }),
  ).toBeVisible();
  view.unmount();
  render(
    <ChallengePlayer initialSession={snapshot("review")} viewer={viewer} />,
  );
  expect(screen.getByRole("region", { name: "Answer feedback" })).toBeVisible();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});
it("keeps final review until Finish and completed history opens recap", () => {
  const view = render(
    <ChallengePlayer initialSession={snapshot("review", 2)} viewer={viewer} />,
  );
  expect(screen.getByRole("button", { name: /Finish session/ })).toBeVisible();
  view.unmount();
  render(
    <ChallengePlayer initialSession={snapshot("completed")} viewer={viewer} />,
  );
  expect(screen.getByRole("heading", { name: /Three calls/ })).toBeVisible();
  expect(document.querySelectorAll("details.recap-card")).toHaveLength(3);
});
