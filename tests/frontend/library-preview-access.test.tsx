import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryMediaPreview } from "@/components/library/LibraryMediaPreview";
import type { LibraryScenarioPreview } from "@/contracts/library";
import type { AccountUser } from "@/contracts/auth";
import { libraryEntry } from "./creator-fixtures";
import { viewer } from "./session-fixtures";

const media = vi.hoisted(() => vi.fn());
vi.mock("@/components/challenge/ScenarioMedia", () => ({
  ScenarioMedia: (props: unknown) => {
    media(props);
    return <div data-testid="scenario-media" />;
  },
}));

function uploaded(): LibraryScenarioPreview {
  const item = libraryEntry();
  if (item.source?.kind !== "youtube")
    throw new Error("Expected a YouTube fixture");
  const { videoId: _videoId, url, ...source } = item.source;
  return {
    ...item,
    source: {
      ...source,
      kind: "uploaded",
      assetId: "82300000-0000-4000-8000-000000000001",
      creditUrl: url,
    },
    setup: {
      kind: "uploaded-video",
      assetId: "82300000-0000-4000-8000-000000000001",
      startSeconds: 0,
      endSeconds: 6,
      alt: "Setup from an uploaded recording",
    },
  };
}

beforeEach(() => media.mockClear());

describe("public Library media access", () => {
  it.each([
    null,
    { ...viewer, emailVerified: false },
  ] as (AccountUser | null)[])(
    "does not mount uploaded playback for an unverified visitor %#",
    (account) => {
      render(<LibraryMediaPreview scenario={uploaded()} viewer={account} />);
      expect(media).not.toHaveBeenCalled();
      expect(screen.queryByTestId("scenario-media")).not.toBeInTheDocument();
      const link = screen.getByRole("link", {
        name: account ? "Verify email →" : "Sign in to preview →",
      });
      expect(link.getAttribute("href")).toContain(
        account ? "/check-email" : "/sign-in",
      );
      const url = new URL(link.getAttribute("href")!, "http://localhost");
      expect(url.searchParams.get("returnTo")).toBe(
        `/library/${uploaded().id}`,
      );
    },
  );

  it("retains context-authorized uploaded previews for a verified learner", () => {
    const scenario = uploaded();
    render(<LibraryMediaPreview scenario={scenario} viewer={viewer} />);
    expect(screen.getByTestId("scenario-media")).toBeInTheDocument();
    expect(media).toHaveBeenCalledWith(
      expect.objectContaining({
        media: scenario.setup,
        context: { kind: "library-scenario", scenarioId: scenario.id },
      }),
    );
  });

  it("allows a guest to preview only the published YouTube setup", () => {
    const scenario = libraryEntry();
    render(<LibraryMediaPreview scenario={scenario} viewer={null} />);
    expect(screen.getByTestId("scenario-media")).toBeInTheDocument();
    expect(media).toHaveBeenCalledWith(
      expect.objectContaining({ media: scenario.setup }),
    );
    const props = media.mock.calls[0][0];
    expect(props).not.toHaveProperty("reveal");
    expect(props).not.toHaveProperty("answer");
  });
});
