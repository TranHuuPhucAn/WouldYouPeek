import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ReportMediaPreview } from "@/components/operator/ReportMediaPreview";
import { operatorDetail, reportId } from "./moderation-fixtures";
const players = vi.hoisted(() => ({
  youtube: vi.fn(),
  uploaded: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock("@/components/challenge/YouTubeScenarioPlayer", () => ({
  YouTubeScenarioPlayer: (props: unknown) => {
    players.youtube(props);
    return <div data-testid="player" />;
  },
}));
vi.mock("@/components/challenge/UploadedScenarioPlayer", () => ({
  UploadedScenarioPlayer: (props: unknown) => {
    players.uploaded(props);
    return <div data-testid="player" />;
  },
}));
vi.mock("@/components/challenge/ScenarioMedia", () => ({
  ScenarioMedia: (props: unknown) => {
    players.legacy(props);
    return <div data-testid="player" />;
  },
}));
beforeEach(() => Object.values(players).forEach((mock) => mock.mockClear()));
it("mounts no media until asked, switches one pinned player, and restores focus on close", async () => {
  const user = userEvent.setup(),
    detail = operatorDetail();
  render(<ReportMediaPreview reportId={reportId} media={detail.media} />);
  expect(players.youtube).not.toHaveBeenCalled();
  expect(players.uploaded).not.toHaveBeenCalled();
  expect(players.legacy).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Watch reported setup" }),
  );
  expect(screen.getAllByTestId("player")).toHaveLength(1);
  expect(players.youtube.mock.lastCall?.[0]).toMatchObject({
    mode: "review-setup",
    setup: detail.media.challenge.setup,
    autoplay: true,
  });
  await user.click(
    screen.getByRole("button", { name: "Watch reported continuation" }),
  );
  expect(screen.getAllByTestId("player")).toHaveLength(1);
  expect(players.youtube.mock.lastCall?.[0]).toMatchObject({
    mode: "reveal",
    reveal: detail.media.reveal,
  });
  await user.click(screen.getByRole("button", { name: "Close video" }));
  expect(screen.queryByTestId("player")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Watch reported continuation" }),
  ).toHaveFocus();
});
it("uses the operator report capability context for uploads without an answer payload", async () => {
  const detail = operatorDetail(),
    assetId = "82300000-0000-4000-8000-000000000001";
  detail.media.challenge.setup = {
    kind: "uploaded-video",
    assetId,
    startSeconds: 0,
    endSeconds: 4,
    alt: "Setup",
  };
  detail.media.reveal = {
    kind: "uploaded-video",
    assetId,
    startSeconds: 4,
    endSeconds: 10,
    alt: "Reveal",
  };
  render(<ReportMediaPreview reportId={reportId} media={detail.media} />);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Watch reported continuation" }));
  expect(players.uploaded.mock.lastCall?.[0]).toMatchObject({
    context: { kind: "operator-report", reportId, phase: "reveal" },
    mode: "reveal",
  });
  expect(players.uploaded.mock.lastCall?.[0]).not.toHaveProperty("answer");
});
it("never mounts a replacement report with a previous report's playback phase", async () => {
  const detail = operatorDetail(),
    user = userEvent.setup();
  const view = render(
    <ReportMediaPreview reportId={reportId} media={detail.media} />,
  );
  await user.click(
    screen.getByRole("button", { name: "Watch reported setup" }),
  );
  players.youtube.mockClear();
  view.rerender(
    <ReportMediaPreview
      reportId="22345678-1234-4234-8234-123456789abc"
      media={{
        ...detail.media,
        challenge: { ...detail.media.challenge, contentVersion: "creator-3" },
      }}
    />,
  );
  expect(players.youtube).not.toHaveBeenCalled();
  expect(screen.queryByTestId("player")).not.toBeInTheDocument();
});
it("unmounts media and prevents replay after operator identity invalidation", async () => {
  render(
    <ReportMediaPreview reportId={reportId} media={operatorDetail().media} />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Watch reported setup" }));
  act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
  expect(screen.queryByTestId("player")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Watch reported setup" }),
  ).toBeDisabled();
});
