import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { HomePageView } from "@/components/home/HomePageView";
import { getCurrentAccount } from "@/server/auth/guards";
import { getHomePageData } from "@/server/home/service";
import type { HomePageData } from "@/contracts/home";
import type { SessionSummary } from "@/contracts/session";
import { homeData, homeScenario, homeViewer } from "./home-fixtures";
import { playlistSession } from "./playlist-fixtures";
import { sessionSummary, viewer } from "./session-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/guards", () => ({ getCurrentAccount: vi.fn() }));
vi.mock("@/server/home/service", () => ({ getHomePageData: vi.fn() }));

beforeEach(() => {
  vi.mocked(getCurrentAccount).mockReset().mockResolvedValue(null);
  vi.mocked(getHomePageData).mockReset().mockResolvedValue(homeData());
});

describe("Home server route", () => {
  it("passes canonical identity to the service and only role/verification to presentation", async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue(viewer);
    vi.mocked(getHomePageData).mockResolvedValue(
      homeData({ resume: { status: "ready", data: null } }),
    );
    const result = await HomePage();
    expect(getHomePageData).toHaveBeenCalledExactlyOnceWith(viewer);
    expect(result.props.viewer).toEqual({
      role: "learner",
      emailVerified: true,
    });
    expect(Object.keys(result.props.viewer).sort()).toEqual([
      "emailVerified",
      "role",
    ]);
    render(result);
    expect(
      screen.getByRole("heading", { level: 1, name: "Your film room." }),
    ).toBeVisible();
    expect(screen.queryByText(viewer.email)).not.toBeInTheDocument();
  });

  it("serves guests through the same public service without a fabricated account", async () => {
    render(await HomePage());
    expect(getHomePageData).toHaveBeenCalledExactlyOnceWith(null);
    expect(
      screen.getByRole("link", { name: /Sign in to play/ }),
    ).toHaveAttribute("href", "/sign-in?returnTo=%2Flibrary");
    expect(
      screen.getByRole("link", { name: homeScenario().title }),
    ).toHaveAttribute("href", `/library/${homeScenario().id}`);
  });

  it("keeps an unresolved identity failure at the existing error boundary", async () => {
    vi.mocked(getCurrentAccount).mockRejectedValue(
      new Error("identity unavailable"),
    );
    await expect(HomePage()).rejects.toThrow("identity unavailable");
    expect(getHomePageData).not.toHaveBeenCalled();
  });
});

describe("Home account states and saved practice", () => {
  it.each([
    {
      label: "guest",
      account: null,
      resume: { status: "guest" } as HomePageData["resume"],
      href: "/sign-up?returnTo=%2Faccount",
      action: "Get started as a creator",
    },
    {
      label: "unverified learner",
      account: homeViewer({ emailVerified: false }),
      resume: { status: "unverified" } as HomePageData["resume"],
      href: "/check-email?returnTo=%2Faccount",
      action: "Verify your email",
    },
    {
      label: "unverified creator",
      account: homeViewer({ role: "creator", emailVerified: false }),
      resume: { status: "unverified" } as HomePageData["resume"],
      href: "/check-email?returnTo=%2Faccount",
      action: "Verify your email",
    },
    {
      label: "learner",
      account: homeViewer(),
      resume: { status: "ready", data: null } as HomePageData["resume"],
      href: "/account",
      action: "Create your own scenarios",
    },
    {
      label: "creator",
      account: homeViewer({ role: "creator" }),
      resume: { status: "ready", data: null } as HomePageData["resume"],
      href: "/creator",
      action: "Open Creator",
    },
  ])(
    "gives $label the existing account destination and no empty progress card",
    ({ account, resume, href, action }) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      render(<HomePageView data={homeData({ resume })} viewer={account} />);
      expect(
        screen.getByRole("link", { name: new RegExp(action) }),
      ).toHaveAttribute("href", href);
      expect(
        screen.queryByRole("region", { name: "Saved session" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: homeScenario().title }),
      ).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Watch. Decide. Compare." }) !==
          null,
      ).toBe(!account);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  const playlist = playlistSession();
  const playlistSummary: SessionSummary = {
    ...sessionSummary(),
    id: playlist.id,
    target: playlist.target,
    title: playlist.title,
    playlist: playlist.playlist,
    answeredCount: 1,
  };
  it.each([
    { label: "legacy", session: { ...sessionSummary(), answeredCount: 2 } },
    {
      label: "single scenario",
      session: {
        ...sessionSummary(),
        target: { kind: "scenario" as const, scenarioId: homeScenario().id },
        title: "One saved moment",
        totalCount: 1,
      },
    },
    { label: "playlist", session: playlistSummary },
  ])(
    "resumes the actual $label session before the featured moment",
    ({ session }) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      render(
        <HomePageView
          data={homeData({ resume: { status: "ready", data: session } })}
          viewer={homeViewer()}
        />,
      );
      const saved = screen.getByRole("region", { name: "Saved session" });
      expect(
        within(saved).getByRole("heading", { level: 2, name: session.title }),
      ).toBeVisible();
      expect(
        within(saved).getByText(
          `${session.answeredCount} of ${session.totalCount} decisions saved.`,
        ),
      ).toBeVisible();
      expect(
        within(saved).getByRole("link", { name: /Resume session/ }),
      ).toHaveAttribute("href", `/play/${session.id}`);
      const feature = screen.getByRole("region", {
        name: "A moment worth a second look.",
      });
      expect(
        saved.compareDocumentPosition(feature) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      if (session.playlist)
        expect(
          within(saved).getByText(
            `Playlist by ${session.playlist.credit.displayName}`,
          ),
        ).toBeVisible();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps discovery usable when saved progress fails, with a real reload and History link", () => {
    render(
      <HomePageView
        data={homeData({ resume: { status: "unavailable" } })}
        viewer={homeViewer()}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Your saved session couldn’t load.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Retry saved session/ }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /View History/ })).toHaveAttribute(
      "href",
      "/history",
    );
    expect(
      screen.getByRole("link", { name: homeScenario().title }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Resume session/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps owned resume useful even when every public feed is unavailable", () => {
    render(
      <HomePageView
        viewer={homeViewer()}
        data={homeData({
          featured: { status: "unavailable" },
          moments: { status: "unavailable" },
          players: { status: "unavailable" },
          playlists: { status: "unavailable" },
          resume: { status: "ready", data: sessionSummary() },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /Resume session/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Retry featured moment/ }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /Retry playlists/ })).toBeVisible();
  });

  it("has one main and H1, ordered section/card headings, and no autoplay or obsolete entry links", () => {
    const { container } = render(
      <HomePageView data={homeData()} viewer={null} />,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 3, name: homeScenario().title }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Taking space together" }),
    ).toBeVisible();
    expect(container.querySelector("video, iframe, audio, img")).toBeNull();
    expect(
      container.querySelector('a[href="/demo"], a[href="/play"]'),
    ).toBeNull();
    expect(screen.getByText(/Several choices can be defensible/)).toBeVisible();
  });
});
