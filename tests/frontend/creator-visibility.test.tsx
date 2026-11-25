import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PublicationControls } from "@/components/creator/PublicationControls";
import { CreatorStatus } from "@/components/creator/CreatorStatus";
import { parseCreatorSnapshot } from "@/lib/client/creator-validation";
import { creatorSnapshot, when } from "./creator-fixtures";
it("shows a creator-safe hold without removing correction and withdrawal actions", () => {
  const scenario = creatorSnapshot(true, true);
  scenario.publication = {
    state: "published",
    currentVersion: "creator-1",
    publishedAt: when,
    hasUnpublishedChanges: true,
    operatorVisibility: {
      hidden: true,
      reason: "Correct the timing.",
      changedAt: when,
    },
  };
  expect(parseCreatorSnapshot(scenario)).toEqual(scenario);
  render(
    <>
      <CreatorStatus publication={scenario.publication} reviewed canReview />
      <PublicationControls
        scenario={scenario}
        disabled={false}
        onPublish={vi.fn()}
        onUnpublish={vi.fn()}
      />
    </>,
  );
  expect(screen.getByText(/Hidden by operator · Published/)).not.toHaveClass(
    "is-published",
  );
  expect(screen.getByText("Correct the timing.")).toBeVisible();
  expect(screen.getByText(/It will stay hidden/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Publish update" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Unpublish" })).toBeEnabled();
  expect(
    screen.queryByRole("link", { name: /View library entry/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Restore/ }),
  ).not.toBeInTheDocument();
});
it("rejects report-private properties and inconsistent safe visibility notices", () => {
  const scenario = creatorSnapshot();
  expect(() =>
    parseCreatorSnapshot({
      ...scenario,
      publication: {
        ...scenario.publication,
        operatorVisibility: {
          hidden: false,
          reason: "Prior private reason",
          changedAt: when,
        },
      },
    }),
  ).toThrow();
  expect(() =>
    parseCreatorSnapshot({
      ...scenario,
      publication: {
        ...scenario.publication,
        operatorVisibility: {
          hidden: true,
          reason: "Hold",
          changedAt: when,
          reporterId: "private",
        },
      },
    }),
  ).toThrow();
  expect(() =>
    parseCreatorSnapshot({
      ...scenario,
      publication: {
        ...scenario.publication,
        operatorVisibility: {
          hidden: true,
          reason: "x".repeat(1001),
          changedAt: when,
        },
      },
    }),
  ).toThrow();
});
