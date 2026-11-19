import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { requirePageAccount, requirePageCreator } from "@/app/protected-page";
import CreatorPage from "@/app/creator/page";
import CreatorVideosPage from "@/app/creator/videos/page";
import { listVideos } from "@/server/video/service";
import { videoList } from "./video-fixtures";
import EditorPage from "@/app/creator/scenarios/[id]/page";
import ReviewPage from "@/app/creator/scenarios/[id]/review/page";
import LibraryPage from "@/app/library/page";
import LibraryDetailPage from "@/app/library/[scenarioId]/page";
import { requireVerifiedUser } from "@/server/auth/guards";
import * as creator from "@/server/creator/service";
import * as library from "@/server/library/service";
import { ApiError } from "@/server/http";
import { viewer } from "./session-fixtures";
import {
  creatorId,
  creatorSnapshot,
  creatorPreview,
  libraryEntry,
} from "./creator-fixtures";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/server/auth/guards", () => ({ requireVerifiedUser: vi.fn() }));
vi.mock("@/server/video/service", () => ({ listVideos: vi.fn() }));
vi.mock("@/components/creator/VideoLibrary", () => ({
  VideoLibrary: () => <div>Private owner recordings</div>,
}));
vi.mock("@/server/creator/service", () => ({
  listOwnedScenarios: vi.fn(),
  findOwnedScenario: vi.fn(),
  getReviewPreview: vi.fn(),
}));
vi.mock("@/server/library/service", () => ({
  getLibrary: vi.fn(),
  getLibraryScenario: vi.fn(),
}));
vi.mock("@/components/creator/CreatorDashboard", () => ({
  CreatorDashboard: () => <div>Owned dashboard</div>,
}));
vi.mock("@/components/creator/ScenarioEditor", () => ({
  ScenarioEditor: () => <div>Owner editor</div>,
}));
vi.mock("@/components/creator/CreatorReview", () => ({
  CreatorReview: ({
    initialError,
    initialPreview,
  }: {
    initialError?: string;
    initialPreview: unknown;
  }) => (
    <div>
      {initialError ??
        (initialPreview ? "Saved owner preview" : "Readiness blockers")}
    </div>
  ),
}));
vi.mock("@/components/library/ScenarioLibrary", () => ({
  ScenarioLibrary: () => <div>Published previews</div>,
}));
vi.mock("@/components/library/ScenarioStart", () => ({
  ScenarioStart: () => <div>Start selected scenario</div>,
}));
vi.mock("@/components/challenge/ScenarioMedia", () => ({
  ScenarioMedia: () => <div>Safe setup only</div>,
}));
beforeEach(() => {
  vi.mocked(listVideos).mockReset().mockResolvedValue(videoList());
  vi.mocked(requireVerifiedUser)
    .mockReset()
    .mockResolvedValue({
      ...viewer,
      role: "creator",
      capabilities: ["learn", "create"],
    });
  vi.mocked(creator.listOwnedScenarios)
    .mockReset()
    .mockResolvedValue({ scenarios: [], nextCursor: null });
  vi.mocked(creator.findOwnedScenario)
    .mockReset()
    .mockResolvedValue(creatorSnapshot());
  vi.mocked(creator.getReviewPreview)
    .mockReset()
    .mockResolvedValue(creatorPreview());
  vi.mocked(library.getLibrary)
    .mockReset()
    .mockResolvedValue({ scenarios: [], nextCursor: null });
  vi.mocked(library.getLibraryScenario)
    .mockReset()
    .mockResolvedValue(libraryEntry());
});
describe("server page authorization and safe load boundaries", () => {
  it.each([
    ["AUTH_REQUIRED", "REDIRECT:/sign-in?returnTo=%2Flibrary"],
    ["EMAIL_NOT_VERIFIED", "REDIRECT:/check-email"],
  ] as const)(
    "redirects %s before loading the library",
    async (code, destination) => {
      vi.mocked(requireVerifiedUser).mockRejectedValue(
        new ApiError(code, "No access"),
      );
      await expect(LibraryPage()).rejects.toThrow(destination);
      expect(library.getLibrary).not.toHaveBeenCalled();
    },
  );
  it("requires creator role for direct editor/review URLs but offers learner opt-in at creator home", async () => {
    vi.mocked(requireVerifiedUser).mockResolvedValue(viewer);
    render(await CreatorPage());
    expect(
      screen.getByRole("link", { name: "Manage creator access →" }),
    ).toBeInTheDocument();
    expect(creator.listOwnedScenarios).not.toHaveBeenCalled();
    await expect(
      EditorPage({ params: Promise.resolve({ id: creatorId }) }),
    ).rejects.toThrow("REDIRECT:/account");
    await expect(
      ReviewPage({ params: Promise.resolve({ id: creatorId }) }),
    ).rejects.toThrow("REDIRECT:/account");
    expect(creator.findOwnedScenario).not.toHaveBeenCalled();
  });
  it("loads creator dashboard and saved owner editor under verified identity", async () => {
    render(await CreatorPage());
    expect(screen.getByText("Owned dashboard")).toBeInTheDocument();
    expect(creator.listOwnedScenarios).toHaveBeenCalledTimes(1);
    render(await EditorPage({ params: Promise.resolve({ id: creatorId }) }));
    expect(screen.getByText("Owner editor")).toBeInTheDocument();
    expect(creator.findOwnedScenario).toHaveBeenCalledWith(creatorId);
  });
  it.each(["SCENARIO_NOT_FOUND", "INVALID_REQUEST"] as const)(
    "maps %s drafts to a generic not-found",
    async (code) => {
      vi.mocked(creator.findOwnedScenario).mockRejectedValue(
        new ApiError(code, "Missing"),
      );
      await expect(
        EditorPage({ params: Promise.resolve({ id: creatorId }) }),
      ).rejects.toThrow("NOT_FOUND");
    },
  );
  it("does not disguise storage failures as missing content", async () => {
    vi.mocked(creator.findOwnedScenario).mockRejectedValue(
      new ApiError("STORAGE_UNAVAILABLE", "Storage down"),
    );
    await expect(
      EditorPage({ params: Promise.resolve({ id: creatorId }) }),
    ).rejects.toThrow("Storage down");
    vi.mocked(requireVerifiedUser).mockRejectedValue(
      new ApiError("STORAGE_UNAVAILABLE", "Auth unavailable"),
    );
    await expect(requirePageAccount("/creator")).rejects.toThrow(
      "Auth unavailable",
    );
  });
  it("never builds a partial preview for an incomplete saved draft", async () => {
    vi.mocked(creator.findOwnedScenario).mockResolvedValue(
      creatorSnapshot(false),
    );
    render(await ReviewPage({ params: Promise.resolve({ id: creatorId }) }));
    expect(screen.getByText("Readiness blockers")).toBeInTheDocument();
    expect(creator.getReviewPreview).not.toHaveBeenCalled();
  });
  it("binds review preview to resource revision and recovers a concurrent change", async () => {
    vi.mocked(creator.getReviewPreview).mockRejectedValue(
      new ApiError("SCENARIO_CONFLICT", "Changed"),
    );
    render(await ReviewPage({ params: Promise.resolve({ id: creatorId }) }));
    expect(creator.getReviewPreview).toHaveBeenCalledWith(creatorId, 1);
    expect(screen.getByText(/saved draft changed while/)).toBeInTheDocument();
  });
  it("serves setup-only library detail and hides withdrawn/missing entries equally", async () => {
    render(
      await LibraryDetailPage({
        params: Promise.resolve({ scenarioId: creatorId }),
      }),
    );
    expect(screen.getByText("Safe setup only")).toBeInTheDocument();
    expect(
      screen.queryByText(creatorSnapshot().draft.content.outcomeText),
    ).not.toBeInTheDocument();
    vi.mocked(library.getLibraryScenario).mockRejectedValue(
      new ApiError("SCENARIO_UNAVAILABLE", "Unavailable"),
    );
    await expect(
      LibraryDetailPage({ params: Promise.resolve({ scenarioId: creatorId }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});

describe("private creator recording page", () => {
  it("loads the video library after creator authorization", async () => {
    render(await CreatorVideosPage());
    expect(screen.getByText("Private owner recordings")).toBeInTheDocument();
    expect(listVideos).toHaveBeenCalledOnce();
  });
  it("does not fetch recordings for learners", async () => {
    vi.mocked(requireVerifiedUser).mockResolvedValue(viewer);
    await expect(CreatorVideosPage()).rejects.toThrow();
    expect(listVideos).not.toHaveBeenCalled();
  });
});
