import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioEditor } from "@/components/creator/ScenarioEditor";
import { DecisionFields } from "@/components/creator/DecisionFields";
import { AnalysisFields } from "@/components/creator/AnalysisFields";
import { useState } from "react";
import * as api from "@/lib/client/creator-api";
import { creatorSnapshot, validContent } from "./creator-fixtures";
import { createUploadedSource } from "@/lib/creator/content";
import { listCreatorVideos } from "@/lib/client/video-api";
import { readyVideo, videoList, VIDEO_ID, OWNER_ID } from "./video-fixtures";
vi.mock("@/lib/client/video-api", () => ({ listCreatorVideos: vi.fn() }));
vi.mock("@/hooks/use-authoring-video", () => ({
  useAuthoringVideo: () => ({
    hasSource: false,
    ready: false,
    seeking: false,
    time: 0,
    duration: null,
  }),
}));
vi.mock("@/lib/client/creator-api", () => ({
  saveCreatorScenario: vi.fn(),
  getCreatorScenario: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.mocked(listCreatorVideos)
    .mockReset()
    .mockResolvedValue(
      videoList([
        readyVideo(),
        { ...readyVideo(), id: OWNER_ID, fileName: "second.mp4" },
      ]),
    );
  vi.mocked(api.saveCreatorScenario)
    .mockReset()
    .mockImplementation(async (_id, input) => {
      const s = creatorSnapshot();
      s.draft.content = input.content;
      s.revision = 2;
      s.draft.revision = 2;
      return { scenario: s, replayed: false, publishedVersion: null };
    });
  vi.mocked(api.getCreatorScenario).mockReset();
});
describe("complete explicit-save creator editor", () => {
  it("explains the known-fact review requirement while keeping other lists optional", () => {
    render(
      <ScenarioEditor
        capabilities={{ sourceMode: "youtube-and-upload" }}
        initial={creatorSnapshot()}
        viewerId="owner"
      />,
    );
    expect(screen.getByLabelText("Known facts")).toHaveAccessibleDescription(
      expect.stringContaining(
        "Add at least one player-visible fact before review or publication",
      ),
    );
    expect(screen.getByLabelText("Known facts")).toHaveAccessibleDescription(
      expect.stringContaining("You can save an incomplete draft without one"),
    );
    for (const label of [
      "Unknown information",
      "Analysis limitations",
      "Choice 1 risks",
      "Choice 1: defensible when",
    ])
      expect(screen.getByLabelText(label)).toHaveAccessibleDescription(
        expect.stringContaining(
          "Leave empty when there are no additional entries",
        ),
      );
  });
  it("saves incomplete work explicitly, without requiring publication fields", async () => {
    render(
      <ScenarioEditor
        capabilities={{ sourceMode: "youtube-and-upload" }}
        initial={creatorSnapshot(false)}
        viewerId="owner"
      />,
    );
    expect(api.saveCreatorScenario).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Scenario title"), {
      target: { value: "Unfinished moment" },
    });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Review saved/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    await waitFor(() =>
      expect(api.saveCreatorScenario).toHaveBeenCalledTimes(1),
    );
    expect(
      vi.mocked(api.saveCreatorScenario).mock.calls[0][1].content.title,
    ).toBe("Unfinished moment");
    expect(
      screen.getByRole("heading", { name: "Saved drafts can be incomplete" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Review saved/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Publish scenario" }),
    ).not.toBeInTheDocument();
  });
  it("shows accessible timestamp errors and blocks malformed input without losing text", () => {
    render(
      <ScenarioEditor
        capabilities={{ sourceMode: "youtube-and-upload" }}
        initial={creatorSnapshot()}
        viewerId="owner"
      />,
    );
    const input = screen.getByLabelText("Decision pause");
    fireEvent.change(input, { target: { value: "not a time" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    expect(api.saveCreatorScenario).not.toHaveBeenCalled();
    expect(input).toHaveValue("not a time");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();
    expect(input.getAttribute("aria-describedby")).toContain(
      "creator-media-decisionSeconds-error",
    );
  });
  it("guards unsaved navigation and unload, and permits leaving after confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ScenarioEditor
        capabilities={{ sourceMode: "youtube-and-upload" }}
        initial={creatorSnapshot()}
        viewerId="owner"
      />,
    );
    fireEvent.change(screen.getByLabelText("Scenario title"), {
      target: { value: "Edited" },
    });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const link = screen.getByRole("link", { name: "← Creator workspace" });
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("unsaved changes"),
    );
  });
  it("renders text safely and hides all private fields after sign-out", () => {
    const s = creatorSnapshot();
    s.draft.content.title = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <ScenarioEditor
        capabilities={{ sourceMode: "youtube-and-upload" }}
        initial={s}
        viewerId="owner"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Scenario title")).toHaveValue(
      s.draft.content.title,
    );
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(screen.queryByLabelText("Scenario title")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Your creator session has changed.",
      }),
    ).toBeInTheDocument();
  });
  it("labels list-item validation at the actual list field", () => {
    const s = creatorSnapshot();
    s.draft.content.knownFacts = ["x".repeat(301)];
    render(
      <ScenarioEditor
        capabilities={{ sourceMode: "youtube-and-upload" }}
        initial={s}
        viewerId="owner"
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Save draft" })[0]);
    const field = screen.getByLabelText("Known facts");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(api.saveCreatorScenario).not.toHaveBeenCalled();
  });
});
describe("stable choice identities", () => {
  function Fields() {
    const [content, setContent] = useState(validContent());
    return (
      <>
        <DecisionFields content={content} onChange={setContent} issues={[]} />
        <AnalysisFields content={content} onChange={setContent} issues={[]} />
        <output aria-label="choice identities">
          {JSON.stringify(content.options.map((o) => o.id))}
        </output>
      </>
    );
  }
  it("retains IDs across reorder and label edits, and clears a removed observed choice", () => {
    render(<Fields />);
    const original = validContent().options.map((o) => o.id);
    fireEvent.click(screen.getByRole("button", { name: "Move choice 1 down" }));
    expect(
      JSON.parse(screen.getByLabelText("choice identities").textContent!),
    ).toEqual([original[1], original[0], original[2]]);
    expect(screen.getByLabelText("Observed pro choice")).toHaveValue(
      original[0],
    );
    fireEvent.change(screen.getByLabelText("Choice 2 label"), {
      target: { value: "Renamed" },
    });
    expect(screen.getByLabelText("Observed pro choice")).toHaveValue(
      original[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove choice 2" }));
    expect(screen.getByLabelText("Observed pro choice")).toHaveValue("");
    expect(
      JSON.parse(screen.getByLabelText("choice identities").textContent!),
    ).toEqual([original[1], original[2]]);
  });
  it("adds independent UUID choices, stops at five and preserves every assessment editor", () => {
    render(<Fields />);
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    expect(screen.getByRole("button", { name: "Add choice" })).toBeDisabled();
    const ids = JSON.parse(
      screen.getByLabelText("choice identities").textContent!,
    );
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids[4]).toMatch(/^[a-f0-9-]{36}$/);
    expect(
      within(screen.getByRole("region", { name: "Choice 5" })).getByLabelText(
        "Choice 5 assessment",
      ),
    ).toBeInTheDocument();
  });
});

const timingLabels = [
  "Setup starts",
  "Decision pause",
  "Continuation ends",
  "Setup description",
  "Paused moment description",
  "Continuation description",
];
function mediaFieldValues() {
  return timingLabels.map(
    (label) => (screen.getByLabelText(label) as HTMLInputElement).value,
  );
}
function savedUploadedScenario() {
  const initial = creatorSnapshot();
  if (initial.draft.content.source.kind === "uploaded")
    throw new Error("Expected the original YouTube fixture");
  const { url: _url, ...attribution } = initial.draft.content.source;
  initial.draft.content.source = {
    ...createUploadedSource(VIDEO_ID),
    ...attribution,
    kind: "uploaded",
    assetId: VIDEO_ID,
  };
  return initial;
}

it("cancels source replacement in-page without changing any saved marks or descriptions", () => {
  const initial = creatorSnapshot(),
    nativeConfirm = vi.spyOn(window, "confirm");
  render(
    <ScenarioEditor
      capabilities={{ sourceMode: "youtube-and-upload" }}
      initial={initial}
      viewerId="owner"
    />,
  );
  const original = screen.getByLabelText("YouTube URL") as HTMLInputElement,
    originalUrl = original.value,
    originalMedia = mediaFieldValues();
  fireEvent.change(original, {
    target: { value: "https://youtu.be/abcdefghijk" },
  });
  const dialog = screen.getByRole("alertdialog", {
    name: "Change the source recording?",
  });
  expect(
    screen.getByRole("button", { name: "Cancel source change" }),
  ).toHaveFocus();
  expect(original).toHaveValue(originalUrl);
  expect(mediaFieldValues()).toEqual(originalMedia);
  expect(nativeConfirm).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(original).toHaveFocus();
  expect(original).toHaveValue(originalUrl);
  expect(mediaFieldValues()).toEqual(originalMedia);
  expect(screen.getByText("All changes saved")).toBeInTheDocument();
  expect(api.saveCreatorScenario).not.toHaveBeenCalled();
});

it("confirms a source change, clears only timing and media descriptions, and keeps latest authored text", () => {
  const initial = creatorSnapshot();
  render(
    <ScenarioEditor
      capabilities={{ sourceMode: "youtube-and-upload" }}
      initial={initial}
      viewerId="owner"
    />,
  );
  fireEvent.change(screen.getByLabelText("YouTube URL"), {
    target: { value: "https://youtu.be/abcdefghijk" },
  });
  fireEvent.change(screen.getByLabelText("Player in the recording"), {
    target: { value: "Updated player credit" },
  });
  fireEvent.change(screen.getByLabelText("Decision question"), {
    target: { value: "Updated question while deciding" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change source" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByLabelText("YouTube URL")).toHaveValue(
    "https://youtu.be/abcdefghijk",
  );
  expect(mediaFieldValues()).toEqual(timingLabels.map(() => ""));
  expect(screen.getByLabelText("Setup starts")).toHaveFocus();
  expect(screen.getByLabelText("Player in the recording")).toHaveValue(
    "Updated player credit",
  );
  expect(screen.getByLabelText("Decision question")).toHaveValue(
    "Updated question while deciding",
  );
  expect(screen.getByLabelText("Choice 1 explanation")).toHaveValue(
    initial.draft.content.options[0].explanation,
  );
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(api.saveCreatorScenario).not.toHaveBeenCalled();
});

it("cancels and confirms an uploaded-to-YouTube switch with matching dropdown and field state", async () => {
  render(
    <ScenarioEditor
      capabilities={{ sourceMode: "youtube-and-upload" }}
      initial={savedUploadedScenario()}
      viewerId="owner"
    />,
  );
  await screen.findByRole("option", { name: "recording.mp4" });
  const originalMedia = mediaFieldValues();
  const kind = screen.getByLabelText("Video source");
  fireEvent.change(kind, { target: { value: "youtube" } });
  expect(kind).toHaveValue("uploaded");
  fireEvent.click(screen.getByRole("button", { name: "Cancel source change" }));
  expect(kind).toHaveValue("uploaded");
  expect(kind).toHaveFocus();
  expect(screen.getByLabelText("Uploaded recording")).toHaveValue(VIDEO_ID);
  expect(mediaFieldValues()).toEqual(originalMedia);
  fireEvent.change(kind, { target: { value: "youtube" } });
  fireEvent.click(screen.getByRole("button", { name: "Change source" }));
  expect(kind).toHaveValue("youtube");
  expect(screen.getByLabelText("YouTube URL")).toHaveValue("");
  expect(screen.queryByLabelText("Uploaded recording")).not.toBeInTheDocument();
  expect(mediaFieldValues()).toEqual(timingLabels.map(() => ""));
});

it("keeps an uploaded asset on cancellation and clears marks only after confirming its replacement", async () => {
  render(
    <ScenarioEditor
      capabilities={{ sourceMode: "youtube-and-upload" }}
      initial={savedUploadedScenario()}
      viewerId="owner"
    />,
  );
  await screen.findByRole("option", { name: "second.mp4" });
  const originalMedia = mediaFieldValues();
  const source = screen.getByLabelText("Uploaded recording");
  fireEvent.change(source, { target: { value: OWNER_ID } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel source change" }));
  expect(source).toHaveValue(VIDEO_ID);
  expect(source).toHaveFocus();
  expect(mediaFieldValues()).toEqual(originalMedia);
  fireEvent.change(source, { target: { value: OWNER_ID } });
  fireEvent.click(screen.getByRole("button", { name: "Change source" }));
  expect(source).toHaveValue(OWNER_ID);
  expect(mediaFieldValues()).toEqual(timingLabels.map(() => ""));
  expect(screen.getByLabelText("Setup starts")).toHaveFocus();
});

it("preserves an unsupported uploaded draft without loading media and restores focus after cancelling its explicit replacement", async () => {
  const initial = savedUploadedScenario();
  render(
    <ScenarioEditor
      initial={initial}
      viewerId="owner"
      capabilities={{ sourceMode: "youtube-only" }}
    />,
  );
  expect(screen.getByLabelText("Scenario title")).toHaveValue(
    initial.draft.content.title,
  );
  expect(listCreatorVideos).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Uploaded recording")).not.toBeInTheDocument();
  expect(
    screen.getByText(/Your timestamps and text are preserved/),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Replace with YouTube link" }),
  );
  expect(
    screen.getByRole("alertdialog", { name: "Change the source recording?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel source change" }));
  expect(
    screen.getByRole("button", { name: "Replace with YouTube link" }),
  ).toHaveFocus();
  expect(api.saveCreatorScenario).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Scenario title")).toHaveValue(
    initial.draft.content.title,
  );
});
