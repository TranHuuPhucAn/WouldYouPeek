import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoLibrary } from "@/components/creator/VideoLibrary";
import { SourceFields } from "@/components/creator/SourceFields";
import * as api from "@/lib/client/video-api";
import * as creators from "@/lib/client/creator-api";
import { createUploadedSource } from "@/lib/creator/content";
import { creatorSnapshot, validContent } from "./creator-fixtures";
import {
  readyVideo,
  videoSnapshot,
  videoList,
  OWNER_ID,
  VIDEO_ID,
} from "./video-fixtures";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/client/video-api");
vi.mock("@/lib/client/creator-api");
vi.mock("@/components/creator/VideoUpload", () => ({
  VideoUpload: ({
    resumeVideo,
  }: {
    resumeVideo: { fileName: string } | null;
  }) => <div data-testid="upload">{resumeVideo?.fileName ?? "Upload"}</div>,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listCreatorVideos).mockResolvedValue(videoList());
});
describe("creator recording library and source selection", () => {
  it("offers only ready recordings in the source picker and retains current saved identity", async () => {
    vi.mocked(api.listCreatorVideos).mockResolvedValue(
      videoList([
        readyVideo(),
        videoSnapshot({ id: OWNER_ID, fileName: "pending.mp4" }),
      ]),
    );
    const replace = vi.fn(() => true);
    render(
      <SourceFields
        capabilities={{ sourceMode: "youtube-and-upload" }}
        source={createUploadedSource()}
        onChange={vi.fn()}
        onReplace={replace}
        issues={[]}
      />,
    );
    await screen.findByRole("option", { name: "recording.mp4" });
    expect(
      screen.queryByRole("option", { name: "pending.mp4" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Uploaded recording"), {
      target: { value: VIDEO_ID },
    });
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: VIDEO_ID }),
    );
  });
  it("confirms a changed YouTube identity while preserving same-video URL changes", () => {
    const content = validContent(),
      replace = vi.fn(() => false),
      change = vi.fn();
    render(
      <SourceFields
        capabilities={{ sourceMode: "youtube-and-upload" }}
        source={content.source}
        onChange={change}
        onReplace={replace}
        issues={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://youtu.be/_yPrykaB2nE?t=99" },
    });
    expect(replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("YouTube URL"), {
      target: { value: "https://youtu.be/abcdefghijk" },
    });
    expect(replace).toHaveBeenCalledOnce();
    expect(change).toHaveBeenLastCalledWith(content.source);
  });
  it("resumes pending uploads and prevents deleting referenced recordings", () => {
    render(
      <VideoLibrary
        initial={videoList([
          videoSnapshot(),
          { ...readyVideo(), id: OWNER_ID, canDelete: false },
        ])}
        viewerId={OWNER_ID}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Resume with original file" }),
    );
    expect(screen.getByTestId("upload")).toHaveTextContent("recording.mp4");
    expect(
      screen.getAllByRole("button", { name: "Remove unused recording" }),
    ).toHaveLength(1);
    expect(
      screen.getByText(/retained for learner history/),
    ).toBeInTheDocument();
  });
  it("creates a draft using a reusable asset without publishing or replacing authored text", async () => {
    const snapshot = creatorSnapshot(false);
    vi.mocked(creators.createCreatorScenario).mockResolvedValue({
      scenario: snapshot,
      replayed: false,
      publishedVersion: null,
    });
    vi.mocked(creators.saveCreatorScenario).mockResolvedValue({
      scenario: snapshot,
      replayed: false,
      publishedVersion: null,
    });
    render(
      <VideoLibrary initial={videoList([readyVideo()])} viewerId={OWNER_ID} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create scenario" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/creator/scenarios/${snapshot.id}`),
    );
    expect(creators.saveCreatorScenario).toHaveBeenCalledWith(
      snapshot.id,
      expect.objectContaining({
        content: expect.objectContaining({
          source: expect.objectContaining({
            kind: "uploaded",
            assetId: VIDEO_ID,
          }),
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(creators.publishCreatorScenario).not.toHaveBeenCalled();
  });
});

it.each(["youtube", "uploaded"] as const)(
  "restores the %s source selector's displayed value after cancellation",
  async (kind) => {
    vi.mocked(api.listCreatorVideos).mockResolvedValue(
      videoList([readyVideo()]),
    );
    const source =
      kind === "uploaded"
        ? createUploadedSource(VIDEO_ID)
        : validContent().source;
    const replace = vi.fn(() => false),
      change = vi.fn();
    render(
      <SourceFields
        capabilities={{ sourceMode: "youtube-and-upload" }}
        source={source}
        onReplace={replace}
        onChange={change}
        issues={[]}
      />,
    );
    if (kind === "uploaded")
      await screen.findByRole("option", { name: "recording.mp4" });
    const selection = screen.getByLabelText("Video source");
    fireEvent.change(selection, {
      target: { value: kind === "uploaded" ? "youtube" : "uploaded" },
    });
    expect(replace).toHaveBeenCalledOnce();
    expect(selection).toHaveValue(kind);
    expect(change).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText(
        kind === "uploaded" ? "Uploaded recording" : "YouTube URL",
      ),
    ).toBeInTheDocument();
  },
);

it("restores the selected uploaded asset after cancellation", async () => {
  vi.mocked(api.listCreatorVideos).mockResolvedValue(
    videoList([
      readyVideo(),
      { ...readyVideo(), id: OWNER_ID, fileName: "second.mp4" },
    ]),
  );
  const replace = vi.fn(() => false),
    change = vi.fn();
  render(
    <SourceFields
      capabilities={{ sourceMode: "youtube-and-upload" }}
      source={createUploadedSource(VIDEO_ID)}
      onReplace={replace}
      onChange={change}
      issues={[]}
    />,
  );
  await screen.findByRole("option", { name: "second.mp4" });
  const selection = screen.getByLabelText("Uploaded recording");
  fireEvent.change(selection, { target: { value: OWNER_ID } });
  expect(replace).toHaveBeenCalledWith(
    expect.objectContaining({ assetId: OWNER_ID }),
  );
  expect(selection).toHaveValue(VIDEO_ID);
  expect(change).not.toHaveBeenCalled();
});

it("offers only YouTube fields and no upload fetch in hosted mode", () => {
  const replace = vi.fn(() => true);
  render(
    <SourceFields
      capabilities={{ sourceMode: "youtube-only" }}
      source={validContent().source}
      onChange={vi.fn()}
      onReplace={replace}
      issues={[]}
    />,
  );
  expect(screen.getByLabelText("YouTube URL")).toBeVisible();
  expect(screen.queryByLabelText("Video source")).not.toBeInTheDocument();
  expect(api.listCreatorVideos).not.toHaveBeenCalled();
});

it("does not fetch an imported uploaded source and requires explicit YouTube replacement", () => {
  const replace = vi.fn(() => false);
  render(
    <SourceFields
      capabilities={{ sourceMode: "youtube-only" }}
      source={createUploadedSource(VIDEO_ID)}
      onChange={vi.fn()}
      onReplace={replace}
      issues={[]}
    />,
  );
  expect(api.listCreatorVideos).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Uploaded recording")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Replace with YouTube link" }),
  );
  expect(replace).toHaveBeenCalledWith(expect.objectContaining({ url: "" }));
});
