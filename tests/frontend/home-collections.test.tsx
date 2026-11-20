import type { AnchorHTMLAttributes } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeHero, HomeMomentCard } from "@/components/home/HomeHero";
import {
  HomePlayerSection,
  HomePlaylistSection,
  HomeMomentSection,
} from "@/components/home/HomeCollections";
import { HomePageView } from "@/components/home/HomePageView";
import { homeData, homeScenario, homeViewer } from "./home-fixtures";
import { preview } from "./playlist-fixtures";
import { sessionSummary } from "./session-fixtures";

vi.mock("next/link", () => ({
  default: ({
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a
      {...props}
      data-prefetch={prefetch === undefined ? "default" : String(prefetch)}
    />
  ),
}));

describe("Home moments", () => {
  it("renders current metadata as a preview link without media or a made-up publication date", () => {
    const moment = homeScenario();
    const { container } = render(
      <HomeHero featured={{ status: "ready", data: moment }} />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: moment.title }),
    ).toBeVisible();
    expect(screen.getByText("TenZ · Bind · Clove")).toBeVisible();
    expect(screen.getByText(moment.topic)).toBeVisible();
    expect(
      screen.getByRole("link", { name: `Explore moment: ${moment.title}` }),
    ).toHaveAttribute("href", `/library/${moment.id}`);
    expect(
      container.querySelector("iframe, video, audio, img, time"),
    ).toBeNull();
  });

  it.each([
    {
      editorialOrigin: "curated" as const,
      provenance: "ai" as const,
      label: "Curated · AI-authored analysis",
    },
    {
      editorialOrigin: "creator" as const,
      provenance: "creator" as const,
      label: "Creator-authored analysis",
    },
    {
      editorialOrigin: "creator" as const,
      provenance: "ai-assisted" as const,
      label: "Creator-reviewed · AI-assisted analysis",
    },
    {
      editorialOrigin: "creator" as const,
      provenance: "ai" as const,
      label: "AI-authored analysis",
    },
  ])(
    "keeps $editorialOrigin/$provenance attribution truthful",
    ({ editorialOrigin, provenance, label }) => {
      render(
        <HomeMomentCard
          moment={homeScenario({ editorialOrigin, provenance })}
        />,
      );
      expect(screen.getByText(label)).toBeVisible();
    },
  );

  it("omits unavailable map/agent cleanly and retains complete long text", () => {
    const title =
      "A particularly long moment title that should remain fully readable without a tooltip";
    render(
      <HomeMomentCard
        moment={homeScenario({ title, map: null, agent: null })}
      />,
    );
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText("TenZ", { selector: "p" })).toBeVisible();
    expect(screen.queryByText(/null|undefined/)).not.toBeInTheDocument();
  });

  it("distinguishes a healthy empty feature from a failed read", () => {
    const view = render(
      <HomeHero featured={{ status: "ready", data: null }} />,
    );
    expect(
      screen.getByText("Published moments will appear here."),
    ).toBeVisible();
    expect(screen.queryByText(/couldn’t load/)).not.toBeInTheDocument();
    view.rerender(<HomeHero featured={{ status: "unavailable" }} />);
    expect(
      screen.getByText("The featured moment couldn’t load."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Retry featured moment/ }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.queryByText("Published moments will appear here."),
    ).not.toBeInTheDocument();
  });
});

describe("Home collections", () => {
  it.each([1, 12])(
    "uses the exact aggregated scenario count of %i and the existing player path",
    (count) => {
      const player = homeScenario().player;
      render(
        <HomePlayerSection
          section={{
            status: "ready",
            data: [{ player, scenarioCount: count }],
          }}
        />,
      );
      expect(screen.getByRole("article")).toHaveTextContent(
        `${count} ${count === 1 ? "scenario" : "scenarios"}`,
      );
      expect(screen.getByRole("link", { name: "TenZ" })).toHaveAttribute(
        "href",
        `/library/players/${player.id}`,
      );
    },
  );

  it("shows an honest empty player state instead of zero-count cards", () => {
    render(<HomePlayerSection section={{ status: "ready", data: [] }} />);
    expect(
      screen.getByText("No player scenarios are published yet."),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("preserves mixed playlist identities, credit, decision count and preview destination", () => {
    const playlist = preview();
    render(
      <HomePlaylistSection section={{ status: "ready", data: [playlist] }} />,
    );
    const section = screen.getByRole("region", { name: "Playlists to study" });
    expect(
      within(section).getByRole("heading", { level: 3, name: playlist.title }),
    ).toBeVisible();
    expect(
      within(section).getByText(`By ${playlist.credit.displayName}`),
    ).toBeVisible();
    expect(
      within(section).getByText(/2 DECISIONS · CREATOR PLAYLIST/),
    ).toBeVisible();
    for (const player of playlist.players)
      expect(
        within(section).getByRole("link", { name: player.displayName }),
      ).toHaveAttribute("href", `/library/players/${player.id}?view=playlists`);
    expect(
      within(section).getByRole("link", { name: playlist.title }),
    ).toHaveAttribute("href", `/library/playlists/${playlist.id}`);
  });

  it("keeps editorial starter credit distinct from a creator-owned playlist", () => {
    const playlist = {
      ...preview(),
      credit: { kind: "editorial" as const, displayName: "Would You Peek" },
    };
    render(
      <HomePlaylistSection section={{ status: "ready", data: [playlist] }} />,
    );
    expect(screen.getByText(/CURATED PLAYLIST/)).toBeVisible();
    expect(screen.getByText("By Would You Peek")).toBeVisible();
    expect(screen.queryByText(/CREATOR PLAYLIST/)).not.toBeInTheDocument();
  });

  it("omits healthy empty optional collections and exposes a failed collection with retry", () => {
    const view = render(
      <>
        <HomePlaylistSection section={{ status: "ready", data: [] }} />
        <HomeMomentSection section={{ status: "ready", data: [] }} />
      </>,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    view.rerender(
      <>
        <HomePlaylistSection section={{ status: "unavailable" }} />
        <HomeMomentSection section={{ status: "unavailable" }} />
        <HomePlayerSection section={{ status: "unavailable" }} />
      </>,
    );
    expect(screen.getAllByRole("region")).toHaveLength(3);
    for (const name of [
      "Retry playlists →",
      "Retry more moments →",
      "Retry player scenarios →",
    ])
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/No player scenarios/)).not.toBeInTheDocument();
  });

  it("does not speculatively fetch any Home destination, including shared resume and playlist links", () => {
    render(
      <HomePageView
        data={homeData({ resume: { status: "ready", data: sessionSummary() } })}
        viewer={homeViewer()}
      />,
    );
    for (const link of screen.getAllByRole("link"))
      expect(link).toHaveAttribute("data-prefetch", "false");
  });
});
