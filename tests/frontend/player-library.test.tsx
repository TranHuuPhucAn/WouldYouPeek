import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerLibrary } from "@/components/library/PlayerLibrary";
import type { LibraryScenarioPreview } from "@/contracts/library";
import type { PlayerGroup, PlayerListResponse } from "@/contracts/player";
import { listLibraryPlayers } from "@/lib/client/library-api";
import { libraryEntry } from "./creator-fixtures";
import { normalizePlayerDisplayName } from "@/lib/players/identity";

vi.mock("@/lib/client/library-api", () => ({ listLibraryPlayers: vi.fn() }));

const tenzId = "76af0a04-4751-4d26-9233-183a252e124b";
const demonId = "10000000-0000-4000-8000-000000000002";

function group(
  displayName = "TenZ",
  id = tenzId,
  scenarioCount = 7,
): PlayerGroup {
  const player = { id, displayName };
  const sources: Pick<
    LibraryScenarioPreview,
    "editorialOrigin" | "provenance"
  >[] = [
    { editorialOrigin: "curated", provenance: "ai" },
    { editorialOrigin: "creator", provenance: "creator" },
    { editorialOrigin: "creator", provenance: "ai-assisted" },
  ];
  return {
    player,
    scenarioCount,
    scenarios: sources
      .slice(0, Math.min(scenarioCount, 3))
      .map((origin, index) => ({
        ...libraryEntry(),
        ...origin,
        id: `${id.slice(0, -1)}${index + 3}`,
        title: `${displayName} setup ${index + 1}`,
        player,
        publishedAt:
          origin.editorialOrigin === "curated"
            ? null
            : libraryEntry().publishedAt,
      })),
  };
}

function page(
  players: PlayerGroup[],
  nextCursor: string | null = null,
): PlayerListResponse {
  return { players, nextCursor };
}

beforeEach(() => vi.mocked(listLibraryPlayers).mockReset());

describe("public player Library", () => {
  it.each(["Player".repeat(60), normalizePlayerDisplayName("ﷺ".repeat(300))])(
    "retains long canonical display names and UUID navigation without truncating metadata %#",
    (name) => {
      const item = group(name, tenzId, 1);
      item.scenarios[0].title = "A decision with a long player credit";
      render(<PlayerLibrary initial={page([item])} />);
      expect(screen.getByRole("heading", { name, level: 2 })).toHaveTextContent(
        name,
      );
      expect(
        screen.getByRole("link", { name: `View all ${name} scenarios →` }),
      ).toHaveAttribute("href", `/library/players/${tenzId}`);
      expect(
        screen.getByText(
          `${name} · ${item.scenarios[0].source?.agent} · ${item.scenarios[0].source?.map}`,
        ),
      ).toBeInTheDocument();
    },
  );
  it("shows all players with real counts, three previews, and canonical player links", () => {
    const tenz = group();
    render(<PlayerLibrary initial={page([tenz])} />);
    expect(screen.getByRole("heading", { name: "All players" })).toBeVisible();
    const section = screen.getByRole("region", { name: "TenZ" });
    expect(within(section).getByText("7 scenarios")).toBeVisible();
    expect(within(section).getAllByRole("article")).toHaveLength(3);
    expect(
      within(section).getByRole("link", { name: "View all TenZ scenarios →" }),
    ).toHaveAttribute("href", `/library/players/${tenzId}`);
    for (const scenario of tenz.scenarios) {
      expect(
        within(section).getByRole("link", { name: scenario.title }),
      ).toHaveAttribute("href", `/library/${scenario.id}`);
    }
    expect(listLibraryPlayers).not.toHaveBeenCalled();
  });

  it("distinguishes curated AI analysis from creator and AI-assisted analysis", () => {
    render(<PlayerLibrary initial={page([group()])} />);
    const cards = screen.getAllByRole("article");
    expect(
      within(cards[0]).getByText("Curated · AI-authored analysis"),
    ).toBeVisible();
    expect(
      within(cards[1]).getByText("Creator-reviewed", { exact: true }),
    ).toBeVisible();
    expect(
      within(cards[2]).getByText("Creator-reviewed · AI-assisted"),
    ).toBeVisible();
    expect(screen.queryByText(/Meddle is visibly/)).not.toBeInTheDocument();
  });

  it("submits accessible search as a GET form and retains the current query", () => {
    render(<PlayerLibrary query="Ten" initial={page([group()])} />);
    const form = screen.getByRole("search") as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/library");
    expect(form.method).toBe("get");
    const input = within(form).getByRole("searchbox", {
      name: "Search players",
    });
    expect(input).toHaveValue("Ten");
    fireEvent.change(input, { target: { value: "Demon1" } });
    expect(new FormData(form).get("query")).toBe("Demon1");
    expect(
      within(form).getByRole("button", { name: "Search" }),
    ).toHaveAttribute("type", "submit");
    expect(
      within(form).getByRole("link", { name: "Clear search" }),
    ).toHaveAttribute("href", "/library");
    expect(
      screen.getByRole("heading", { name: "Players matching “Ten”" }),
    ).toBeVisible();
    expect(listLibraryPlayers).not.toHaveBeenCalled();
  });

  it("keeps empty catalogue and empty search states useful", () => {
    const view = render(<PlayerLibrary initial={page([])} />);
    expect(
      screen.getByRole("heading", { name: "No scenarios available yet." }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /demo/i }),
    ).not.toBeInTheDocument();
    view.rerender(
      <PlayerLibrary key="missing" query="missing" initial={page([])} />,
    );
    expect(
      screen.getByRole("heading", { name: "No players found." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse all players →" }),
    ).toHaveAttribute("href", "/library");
  });

  it("retains query and cursor while deduplicating overlapping player pages", async () => {
    const updated = group("TenZ", tenzId, 8);
    vi.mocked(listLibraryPlayers).mockResolvedValueOnce(
      page([updated, group("Demon1", demonId, 1)], "second-cursor"),
    );
    vi.mocked(listLibraryPlayers).mockResolvedValueOnce(page([]));
    render(
      <PlayerLibrary query="en" initial={page([group()], "first-cursor")} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more players" }));
    await screen.findByRole("region", { name: "Demon1" });
    expect(screen.getAllByRole("region", { name: "TenZ" })).toHaveLength(1);
    expect(
      within(screen.getByRole("region", { name: "TenZ" })).getByText(
        "8 scenarios",
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Demon1" })).getByText(
        "1 scenario",
      ),
    ).toBeVisible();
    expect(listLibraryPlayers).toHaveBeenNthCalledWith(
      1,
      { query: "en", cursor: "first-cursor" },
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more players" }));
    await act(async () => {});
    expect(listLibraryPlayers).toHaveBeenNthCalledWith(
      2,
      { query: "en", cursor: "second-cursor" },
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByRole("button", { name: "Load more players" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "TenZ" })).toBeVisible();
  });

  it("preserves loaded results and retries the same page after a read failure", async () => {
    vi.mocked(listLibraryPlayers).mockRejectedValueOnce(new Error("Offline"));
    vi.mocked(listLibraryPlayers).mockResolvedValueOnce(
      page([group("Demon1", demonId, 1)]),
    );
    render(<PlayerLibrary query="en" initial={page([group()], "next")} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more players" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your current results are still here.",
    );
    expect(screen.getByRole("region", { name: "TenZ" })).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading players" }),
    );
    await screen.findByRole("region", { name: "Demon1" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(listLibraryPlayers).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(listLibraryPlayers).mock.calls.map(([input]) => input),
    ).toEqual([
      { query: "en", cursor: "next" },
      { query: "en", cursor: "next" },
    ]);
  });

  it("prevents duplicate requests and aborts pagination when unmounted", async () => {
    let resolve!: (value: PlayerListResponse) => void;
    vi.mocked(listLibraryPlayers).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<PlayerLibrary initial={page([group()], "next")} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more players" }));
    const pending = screen.getByRole("button", { name: "Loading…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(listLibraryPlayers).toHaveBeenCalledTimes(1);
    const signal = vi.mocked(listLibraryPlayers).mock.calls[0][1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(page([group("Demon1", demonId, 1)])));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("discards an old search page when the route remounts for a new query", async () => {
    let resolve!: (value: PlayerListResponse) => void;
    vi.mocked(listLibraryPlayers).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <PlayerLibrary
        key="Ten"
        query="Ten"
        initial={page([group()], "old-page")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more players" }));
    const signal = vi.mocked(listLibraryPlayers).mock.calls[0][1];
    view.rerender(
      <PlayerLibrary
        key="Demon"
        query="Demon"
        initial={page([group("Demon1", demonId, 1)])}
      />,
    );
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(page([group()])));
    expect(
      screen.getByRole("searchbox", { name: "Search players" }),
    ).toHaveValue("Demon");
    expect(screen.getByRole("region", { name: "Demon1" })).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "TenZ" }),
    ).not.toBeInTheDocument();
  });
});
