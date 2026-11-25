import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "@/app/library/page";
import PlayerPage from "@/app/library/players/[playerId]/page";
import DemoPage from "@/app/demo/page";
import PlayPage from "@/app/play/page";
import SignInPage from "@/app/(auth)/sign-in/page";
import SignUpPage from "@/app/(auth)/sign-up/page";
import CheckEmailPage from "@/app/(auth)/check-email/page";
import { getCurrentAccount } from "@/server/auth/guards";
import { getPlayers, getPlayer } from "@/server/players/service";
import { getLibrary } from "@/server/library/service";
import { getActiveSessionSummary } from "@/server/training/service";
import { TENZ_PLAYER_ID } from "@/contracts/player";
import { ApiError } from "@/server/http";
import { libraryEntry } from "./creator-fixtures";
import { sessionSummary, viewer } from "./session-fixtures";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/challenge", () => ({
  getAuthChallengeConfig: () => ({ kind: "none" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/server/auth/guards", () => ({ getCurrentAccount: vi.fn() }));
vi.mock("@/server/players/service", () => ({
  getPlayers: vi.fn(),
  getPlayer: vi.fn(),
}));
vi.mock("@/server/library/service", () => ({ getLibrary: vi.fn() }));
vi.mock("@/server/training/service", () => ({
  getActiveSessionSummary: vi.fn(),
}));
vi.mock("@/components/auth/SignInForm", () => ({
  SignInForm: ({ returnTo }: { returnTo: string }) => <p>{returnTo}</p>,
}));
vi.mock("@/components/auth/SignUpForm", () => ({
  SignUpForm: ({ returnTo }: { returnTo: string }) => <p>{returnTo}</p>,
}));
vi.mock("@/components/auth/ResendVerificationForm", () => ({
  ResendVerificationForm: ({ returnTo }: { returnTo: string }) => (
    <p>{returnTo}</p>
  ),
}));
const page = (query?: string) =>
  LibraryPage({ searchParams: Promise.resolve({ query }) });
beforeEach(() => {
  vi.mocked(getCurrentAccount).mockReset().mockResolvedValue(null);
  vi.mocked(getPlayers)
    .mockReset()
    .mockResolvedValue({
      players: [
        {
          player: libraryEntry().player,
          scenarioCount: 1,
          scenarios: [libraryEntry()],
        },
      ],
      nextCursor: null,
    });
  vi.mocked(getPlayer).mockReset().mockResolvedValue(libraryEntry().player);
  vi.mocked(getLibrary)
    .mockReset()
    .mockResolvedValue({ scenarios: [libraryEntry()], nextCursor: null });
  vi.mocked(getActiveSessionSummary)
    .mockReset()
    .mockResolvedValue(sessionSummary());
});
describe("public Library and compatibility pages", () => {
  it.each([null, { ...viewer, emailVerified: false }])(
    "serves the catalogue without requesting private progress for visitor %#",
    async (account) => {
      vi.mocked(getCurrentAccount).mockResolvedValue(account);
      render(await page("TenZ"));
      expect(
        screen.getByRole("heading", { name: "Existing scenarios" }),
      ).toBeVisible();
      expect(
        screen.getByRole("link", { name: libraryEntry().title }),
      ).toBeVisible();
      expect(getPlayers).toHaveBeenCalledWith({ query: "TenZ" });
      expect(getActiveSessionSummary).not.toHaveBeenCalled();
    },
  );
  it("includes only the signed-in learner's saved session and keeps public results when that read fails", async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue(viewer);
    const rendered = render(await page());
    expect(
      screen.getByRole("link", { name: "Resume session →" }),
    ).toHaveAttribute("href", `/play/${sessionSummary().id}`);
    rendered.unmount();
    vi.mocked(getActiveSessionSummary).mockRejectedValue(
      new Error("Storage offline"),
    );
    render(await page());
    expect(
      screen.getByRole("link", { name: libraryEntry().title }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "saved session couldn’t load",
    );
  });
  it("shows a real catalogue load failure without substituting demo data", async () => {
    vi.mocked(getPlayers).mockRejectedValue(new Error("Storage offline"));
    render(await page());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "library couldn’t load",
    );
    expect(
      screen.queryByRole("link", { name: libraryEntry().title }),
    ).not.toBeInTheDocument();
  });
  it("filters a canonical player's page and safely handles missing identities", async () => {
    render(
      await PlayerPage({
        params: Promise.resolve({ playerId: TENZ_PLAYER_ID }),
      }),
    );
    expect(getLibrary).toHaveBeenCalledWith({ playerId: TENZ_PLAYER_ID });
    expect(screen.getByRole("heading", { name: "TenZ" })).toBeVisible();
    vi.mocked(getPlayer).mockResolvedValue(null);
    await expect(
      PlayerPage({ params: Promise.resolve({ playerId: TENZ_PLAYER_ID }) }),
    ).rejects.toThrow("NOT_FOUND");
    vi.mocked(getPlayer).mockRejectedValue(
      new ApiError("INVALID_REQUEST", "Bad id"),
    );
    await expect(
      PlayerPage({ params: Promise.resolve({ playerId: "bad" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
  it("redirects old demo links to canonical TenZ or Library if absent", async () => {
    await expect(DemoPage()).rejects.toThrow(
      `REDIRECT:/library/players/${TENZ_PLAYER_ID}`,
    );
    expect(getPlayer).toHaveBeenCalledWith(TENZ_PLAYER_ID);
    vi.mocked(getPlayer).mockResolvedValue(null);
    await expect(DemoPage()).rejects.toThrow("REDIRECT:/library");
  });
  it("never starts a session from the legacy play GET, resuming only verified owned progress", async () => {
    await expect(PlayPage()).rejects.toThrow("REDIRECT:/library");
    expect(getActiveSessionSummary).not.toHaveBeenCalled();
    vi.mocked(getCurrentAccount).mockResolvedValue(viewer);
    await expect(PlayPage()).rejects.toThrow(
      `REDIRECT:/play/${sessionSummary().id}`,
    );
    vi.mocked(getActiveSessionSummary).mockResolvedValue(null);
    await expect(PlayPage()).rejects.toThrow("REDIRECT:/library");
  });
});
describe("selected scenario authentication return", () => {
  const returnTo = "/library/tenz-bind-clove-utility-before-contact";
  it.each([
    [SignInPage, "Create an account", "/sign-up"],
    [SignUpPage, "Sign in", "/sign-in"],
    [CheckEmailPage, "Sign in", "/sign-in"],
  ] as const)(
    "preserves the exact selected scenario between auth pages %#",
    async (Page, name, destination) => {
      render(await Page({ searchParams: Promise.resolve({ returnTo }) }));
      const link = new URL(
        screen.getByRole("link", { name }).getAttribute("href")!,
        "http://localhost",
      );
      expect(link.pathname).toBe(destination);
      expect(link.searchParams.get("returnTo")).toBe(returnTo);
      expect(screen.getByText(returnTo)).toBeVisible();
    },
  );
});
