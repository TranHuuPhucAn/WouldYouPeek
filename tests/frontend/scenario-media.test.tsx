import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";

describe("scenario media", () => {
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
