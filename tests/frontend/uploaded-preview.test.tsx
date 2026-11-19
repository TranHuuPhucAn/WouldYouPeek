import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenarioPreview } from "@/components/creator/ScenarioPreview";
import { UploadedScenarioPlayer } from "@/components/challenge/UploadedScenarioPlayer";
import { creatorPreview } from "./creator-fixtures";
import { VIDEO_ID } from "./video-fixtures";
vi.mock("@/components/challenge/UploadedScenarioPlayer", () => ({
  UploadedScenarioPlayer: vi.fn(
    ({ mode, onComplete }: { mode: string; onComplete: () => void }) => (
      <div>
        <span>{mode}</span>
        <button onClick={onComplete}>Finish setup segment</button>
      </div>
    ),
  ),
}));
it("uses the saved revision's authoring context and reveals only after a choice", () => {
  const preview = creatorPreview();
  const c = preview.challenge;
  if (c.setup.kind !== "youtube" || c.source?.kind !== "youtube")
    throw new Error("Expected legacy test recording");
  const {
    kind: _kind,
    videoId: _videoId,
    url: _url,
    ...attribution
  } = c.source;
  c.source = {
    ...attribution,
    kind: "uploaded",
    assetId: VIDEO_ID,
    creditUrl: "",
  };
  c.setup = {
    kind: "uploaded-video",
    assetId: VIDEO_ID,
    startSeconds: c.setup.startSeconds,
    endSeconds: c.setup.endSeconds,
    alt: c.setup.alt,
  };
  for (const answer of Object.values(preview.feedbackByOption)) {
    if (answer.reveal.kind !== "youtube") throw new Error("Expected recording");
    answer.reveal = {
      kind: "uploaded-video",
      assetId: VIDEO_ID,
      startSeconds: answer.reveal.startSeconds,
      endSeconds: answer.reveal.endSeconds,
      alt: answer.reveal.alt,
    };
  }
  render(<ScenarioPreview preview={preview} />);
  expect(vi.mocked(UploadedScenarioPlayer).mock.calls.at(-1)![0]).toMatchObject(
    {
      context: {
        kind: "creator-scenario",
        scenarioId: preview.scenario.id,
        revision: preview.scenario.revision,
        phase: "setup",
      },
      reveal: undefined,
    },
  );
  expect(
    screen.queryByRole("region", { name: "Answer feedback" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Finish setup segment" }));
  fireEvent.click(
    screen.getByRole("radio", { name: new RegExp(c.options[0].label) }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Lock in/ }));
  expect(vi.mocked(UploadedScenarioPlayer).mock.calls.at(-1)![0]).toMatchObject(
    {
      mode: "reveal",
      context: { phase: "reveal" },
      reveal: { assetId: VIDEO_ID },
    },
  );
  expect(
    screen.getByRole("region", { name: "Answer feedback" }),
  ).toBeInTheDocument();
});
