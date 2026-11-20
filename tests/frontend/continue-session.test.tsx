import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContinueSessionCard } from "@/components/sessions/ContinueSessionCard";
import { sessionSummary } from "./session-fixtures";
import { creatorId } from "./creator-fixtures";
import { playlistSession } from "./playlist-fixtures";

describe("Library saved-session entry", () => {
  it("preserves frozen playlist credit and saved progress when Home disables prefetch", () => {
    const saved = playlistSession();
    const session = {
      ...sessionSummary(),
      target: saved.target,
      title: saved.title,
      playlist: saved.playlist,
      answeredCount: 2,
    };
    render(<ContinueSessionCard session={session} prefetch={false} />);
    expect(screen.getByText(session.title)).toBeVisible();
    expect(screen.getByText("Playlist by Coach Example")).toBeVisible();
    expect(screen.getByText("2 of 3 decisions saved.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Resume session/ }),
    ).toHaveAttribute("href", `/play/${session.id}`);
  });
  it("shows the owned legacy session and links to the same player without starting a new run", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const session = { ...sessionSummary(), answeredCount: 2 };
    render(<ContinueSessionCard session={session} />);
    expect(screen.getByText(session.title)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /resume/i })).toHaveAttribute(
      "href",
      `/play/${session.id}`,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses actual single-scenario progress instead of a fixed three-scenario count", () => {
    const session = {
      ...sessionSummary(),
      target: { kind: "scenario" as const, scenarioId: creatorId },
      title: "One published decision",
      totalCount: 1,
      answeredCount: 1,
    };
    render(<ContinueSessionCard session={session} />);
    expect(screen.getByText("One published decision")).toBeInTheDocument();
    expect(screen.getByText(/1 of 1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /resume/i })).toHaveAttribute(
      "href",
      `/play/${session.id}`,
    );
    expect(screen.queryByText(/three/i)).not.toBeInTheDocument();
  });
});
