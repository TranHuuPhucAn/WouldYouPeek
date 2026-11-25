import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoUpload } from "@/components/creator/VideoUpload";
import { useVideoUpload } from "@/hooks/use-video-upload";
import { videoSnapshot, readyVideo, OWNER_ID } from "./video-fixtures";
vi.mock("@/hooks/use-video-upload");
let upload: ReturnType<typeof useVideoUpload>;
beforeEach(() => {
  upload = {
    stage: "idle",
    video: null,
    bytes: 0,
    preparedBytes: 0,
    error: null,
    invalid: false,
    hasPendingReservation: false,
    selectedFileName: null,
    hasSelectedFile: false,
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    reset: vi.fn(),
    retryComplete: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    syncVideo: vi.fn(),
  };
  vi.mocked(useVideoUpload).mockImplementation(() => upload);
});
describe("recording upload controls", () => {
  it("requires file selection and carries the existing asset into resume", () => {
    const existing = videoSnapshot();
    render(
      <VideoUpload
        viewerId={OWNER_ID}
        resumeVideo={existing}
        onVideo={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Resume upload" }),
    ).toBeDisabled();
    const file = new File(["abcdef"], "recording.mp4", { type: "video/mp4" });
    fireEvent.change(screen.getByLabelText("Recording file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resume upload" }));
    expect(upload.start).toHaveBeenCalledWith(file, existing);
    expect(screen.getByText(/Reselect the original file/)).toBeInTheDocument();
  });
  it("shows actual byte progress, supports pause, and requires confirmation before removal", () => {
    upload = {
      ...upload,
      stage: "uploading",
      video: videoSnapshot(),
      bytes: 3,
      hasSelectedFile: true,
    };
    render(<VideoUpload viewerId={OWNER_ID} onVideo={vi.fn()} />);
    expect(
      screen.getByRole("progressbar", { name: "Upload progress" }),
    ).toHaveAttribute("value", "3");
    expect(
      screen.getByRole("progressbar", { name: "Upload progress" }),
    ).toHaveAttribute("max", "6");
    fireEvent.click(screen.getByRole("button", { name: "Pause upload" }));
    expect(upload.pause).toHaveBeenCalledOnce();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(upload.cancel).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(upload.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Recording ready\./)).not.toBeInTheDocument();
  });
  it("shows server-confirmed readiness and clears private controls after auth changes", () => {
    upload = { ...upload, stage: "ready", video: readyVideo() };
    const view = render(<VideoUpload viewerId={OWNER_ID} onVideo={vi.fn()} />);
    expect(screen.getByText(/Recording ready\./)).toBeInTheDocument();
    upload = { ...upload, invalid: true };
    view.rerender(<VideoUpload viewerId={OWNER_ID} onVideo={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("session changed");
    expect(screen.queryByLabelText("Recording file")).not.toBeInTheDocument();
  });
});
