import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoTimingEditor } from "@/components/creator/VideoTimingEditor";
import { useAuthoringVideo } from "@/hooks/use-authoring-video";
import { createEmptyDraft, createUploadedSource } from "@/lib/creator/content";
import { VIDEO_ID } from "./video-fixtures";
vi.mock("@/hooks/use-authoring-video");
let player: ReturnType<typeof useAuthoringVideo>;
beforeEach(() => {
  player = {
    uploaded: true,
    hasSource: true,
    sourceUrl: undefined,
    ready: true,
    playing: false,
    seeking: false,
    time: 12.34,
    duration: 120,
    volume: 1,
    error: null,
    nativeRef: { current: null },
    youtubeHost: { current: null },
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    seek: vi.fn(),
    readTime: vi.fn(() => 12.456),
    setVolume: vi.fn(),
    retry: vi.fn(),
    nativeHandlers: {},
  } as unknown as ReturnType<typeof useAuthoringVideo>;
  vi.mocked(useAuthoringVideo).mockImplementation(() => player);
});
describe("manual authoring timeline", () => {
  it("marks the live player time and synchronizes typed fields without saving", () => {
    const change = vi.fn(),
      issues = vi.fn(),
      media = createEmptyDraft().media;
    render(
      <VideoTimingEditor
        source={createUploadedSource(VIDEO_ID)}
        media={media}
        issues={[]}
        onChange={change}
        onInputIssues={issues}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set decision pause" }));
    expect(player.pause).toHaveBeenCalled();
    expect(change).toHaveBeenLastCalledWith({
      ...media,
      decisionSeconds: 12.456,
    });
    expect(screen.getByLabelText("Decision pause")).toHaveValue("0:12.456");
    fireEvent.change(screen.getByLabelText("Decision pause"), {
      target: { value: "not a time" },
    });
    expect(screen.getByLabelText("Decision pause")).toHaveValue("not a time");
    expect(issues).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: "media.decisionSeconds" }),
      ]),
    );
  });
  it("disables marking during seeking and reports timestamps beyond known duration", () => {
    player = { ...player, seeking: true, duration: 30 };
    const issues = vi.fn();
    render(
      <VideoTimingEditor
        source={createUploadedSource(VIDEO_ID)}
        media={{ ...createEmptyDraft().media, endSeconds: 35 }}
        issues={[]}
        onChange={vi.fn()}
        onInputIssues={issues}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Set setup start" }),
    ).toBeDisabled();
    expect(issues).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: "media.endSeconds" }),
      ]),
    );
  });
  it("rehearses only the marked range and pauses at its end", () => {
    const media = {
      ...createEmptyDraft().media,
      startSeconds: 10,
      decisionSeconds: 20,
      endSeconds: 30,
    };
    const view = render(
      <VideoTimingEditor
        source={createUploadedSource(VIDEO_ID)}
        media={media}
        issues={[]}
        onChange={vi.fn()}
        onInputIssues={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play marked range" }));
    expect(player.seek).toHaveBeenCalledWith(10);
    player = { ...player, time: 10 };
    view.rerender(
      <VideoTimingEditor
        source={createUploadedSource(VIDEO_ID)}
        media={media}
        issues={[]}
        onChange={vi.fn()}
        onInputIssues={vi.fn()}
      />,
    );
    expect(player.play).toHaveBeenCalled();
    player = { ...player, time: 29.8 };
    view.rerender(
      <VideoTimingEditor
        source={createUploadedSource(VIDEO_ID)}
        media={media}
        issues={[]}
        onChange={vi.fn()}
        onInputIssues={vi.fn()}
      />,
    );
    expect(player.pause).toHaveBeenCalledTimes(2);
  });
});
