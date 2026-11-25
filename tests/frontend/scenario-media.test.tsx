import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";

describe("scenario media", () => {
  it("pauses native media and ignores completion until playback is explicitly resumed", () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, "paused", {
          configurable: true,
          value: true,
        });
      });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(async function (this: HTMLMediaElement) {
        Object.defineProperty(this, "paused", {
          configurable: true,
          value: false,
        });
        this.dispatchEvent(new Event("play"));
      });
    const complete = vi.fn();
    const props = {
      media: {
        kind: "video" as const,
        src: "/setup.mp4",
        alt: "Recorded setup",
      },
      label: "Source",
      onComplete: complete,
      autoplay: false,
    };
    const view = render(<ScenarioMedia {...props} />);
    const video = screen.getByLabelText("Recorded setup") as HTMLVideoElement;
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
    });
    fireEvent.play(video);
    video.currentTime = 4;
    view.rerender(<ScenarioMedia {...props} suspended />);
    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(4);
    fireEvent.ended(video);
    expect(complete).not.toHaveBeenCalled();
    view.rerender(<ScenarioMedia {...props} />);
    fireEvent.loadedData(video);
    fireEvent.ended(video);
    expect(play).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    Object.defineProperty(video, "paused", {
      configurable: true,
      value: false,
    });
    fireEvent.play(video);
    expect(video.paused).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resume video" }));
    fireEvent.ended(video);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("blocks illustration acknowledgement while a dialog is open", () => {
    const complete = vi.fn();
    const props = {
      media: { kind: "illustration" as const, src: "/scene.svg", alt: "Scene" },
      label: "Source",
      onComplete: complete,
    };
    const view = render(<ScenarioMedia {...props} suspended />);
    const button = screen.getByRole("button", { name: /Continue to decision/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(complete).not.toHaveBeenCalled();
    view.rerender(<ScenarioMedia {...props} />);
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(complete).toHaveBeenCalledOnce();
  });
  it("requires explicit continuation for an illustration", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ScenarioMedia
        media={{
          kind: "illustration",
          src: "/scene.svg",
          alt: "Original scene",
        }}
        label="Illustrative demo"
        onComplete={onComplete}
      />,
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "Original scene" })).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /Continue to decision/ }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it("uses native video controls and advances when setup playback ends", () => {
    const onComplete = vi.fn();
    render(
      <ScenarioMedia
        media={{ kind: "video", src: "/sample.mp4", alt: "Recorded setup" }}
        label="Recorded gameplay"
        onComplete={onComplete}
      />,
    );
    const video = screen.getByLabelText("Recorded setup");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(
      screen.queryByRole("button", { name: /Continue to decision/ }),
    ).not.toBeInTheDocument();
    fireEvent.ended(video);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  it.each(["illustration", "video"] as const)(
    "shows a recoverable %s error without silently substituting assets",
    async (kind) => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      render(
        <ScenarioMedia
          media={{ kind, src: "/missing", alt: "Missing scene" }}
          label="Test media"
          onComplete={onComplete}
        />,
      );
      const media =
        kind === "video"
          ? screen.getByLabelText("Missing scene")
          : screen.getByRole("img");
      fireEvent.error(media);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Media couldn’t load",
      );
      expect(onComplete).not.toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: /Continue to decision/ }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Retry media" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        kind === "video"
          ? screen.getByLabelText("Missing scene")
          : screen.getByRole("img"),
      ).toHaveAttribute("src", "/missing");
    },
  );
  it("labels an authored outcome and does not expose setup continuation controls", () => {
    render(
      <ScenarioMedia
        media={{
          kind: "illustration",
          src: "/outcome.svg",
          alt: "Authored outcome",
        }}
        label="Authored continuation · Illustrative demo"
      />,
    );
    expect(
      screen.getByRole("region", {
        name: "Authored continuation · Illustrative demo",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
