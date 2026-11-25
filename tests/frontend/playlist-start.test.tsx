import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  renderHook,
} from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { SessionStart } from "@/components/sessions/SessionStart";
import { useChallengeSession } from "@/hooks/use-challenge-session";
import { SessionRecap } from "@/components/challenge/SessionRecap";
import * as api from "@/lib/client/session-api";
import { ApiClientError } from "@/lib/client/api-response";
import {
  playlistId,
  publicationId,
  playlistSession,
  credit,
} from "./playlist-fixtures";
import { viewer, sessionSummary, snapshot } from "./session-fixtures";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/client/session-api", () => ({
  createOrResumeSession: vi.fn(),
  getSession: vi.fn(),
  validateSessionContinuity: vi.fn(),
}));
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.createOrResumeSession).mockResolvedValue({
    session: playlistSession(),
    created: true,
    replayed: false,
  });
});
function setup(account: typeof viewer | null = viewer) {
  return render(
    <SessionStart
      viewer={account}
      target={{ kind: "playlist", playlistId }}
      expectedPublicationVersion={publicationId}
      returnTo={`/library/playlists/${playlistId}`}
    />,
  );
}
describe("preview-bound playlist starts", () => {
  it("keeps guest and unverified returns on exact preview without creating a session", () => {
    const view = setup(null);
    expect(
      screen.getByRole("link", { name: /Sign in to play/ }),
    ).toHaveAttribute(
      "href",
      `/sign-in?returnTo=${encodeURIComponent(`/library/playlists/${playlistId}`)}`,
    );
    view.unmount();
    setup({ ...viewer, emailVerified: false });
    expect(screen.getByRole("link", { name: /Verify email/ })).toHaveAttribute(
      "href",
      `/check-email?returnTo=${encodeURIComponent(`/library/playlists/${playlistId}`)}`,
    );
    expect(api.createOrResumeSession).not.toHaveBeenCalled();
  });
  it("freezes target and expected publication through an unknown retry", async () => {
    vi.mocked(api.createOrResumeSession).mockRejectedValueOnce(
      new Error("Offline"),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Retry starting playlist/ }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/play/${playlistSession().id}`),
    );
    const calls = vi.mocked(api.createOrResumeSession).mock.calls;
    expect(calls[0][0]).toEqual({
      requestId: expect.any(String),
      target: { kind: "playlist", playlistId },
      expectedPublicationVersion: publicationId,
    });
    expect(calls[1][0]).toEqual(calls[0][0]);
  });
  it("offers current active resume on conflict and requires fresh preview after publication changes", async () => {
    vi.mocked(api.createOrResumeSession).mockRejectedValueOnce(
      new ApiClientError("ACTIVE_SESSION_EXISTS", "Active", 409, {
        activeSession: sessionSummary(),
      }),
    );
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    await screen.findByRole("link", { name: /Resume current/ });
    expect(
      screen.queryByRole("button", { name: /Start playlist/ }),
    ).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(api.createOrResumeSession).mockRejectedValueOnce(
      new ApiClientError("PLAYLIST_CHANGED", "Changed", 409),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    expect(
      await screen.findByRole("link", { name: "Refresh playlist preview" }),
    ).toHaveAttribute("href", `/library/playlists/${playlistId}`);
    expect(
      screen.queryByRole("button", { name: /Retry/ }),
    ).not.toBeInTheDocument();
  });
  it("discards a prior context's pending command after a refreshed publication or account switch", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof api.createOrResumeSession>>,
    ) => void;
    vi.mocked(api.createOrResumeSession).mockImplementationOnce(
      () => new Promise((r) => (resolve = r)),
    );
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    const first = vi.mocked(api.createOrResumeSession).mock.calls[0];
    const fresh = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    view.rerender(
      <SessionStart
        viewer={viewer}
        target={{ kind: "playlist", playlistId }}
        expectedPublicationVersion={fresh}
        returnTo={`/library/playlists/${playlistId}`}
      />,
    );
    expect(first[1]?.aborted).toBe(true);
    await act(async () =>
      resolve({ session: playlistSession(), created: true, replayed: false }),
    );
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    await waitFor(() =>
      expect(api.createOrResumeSession).toHaveBeenCalledTimes(2),
    );
    const second = vi.mocked(api.createOrResumeSession).mock.calls[1][0];
    expect(second.expectedPublicationVersion).toBe(fresh);
    expect(second.requestId).not.toBe(first[0].requestId);
    view.rerender(
      <SessionStart
        viewer={{ ...viewer, id: fresh }}
        target={{ kind: "playlist", playlistId }}
        expectedPublicationVersion={fresh}
        returnTo={`/library/playlists/${playlistId}`}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    await waitFor(() =>
      expect(api.createOrResumeSession).toHaveBeenCalledTimes(3),
    );
    expect(
      vi.mocked(api.createOrResumeSession).mock.calls[2][0].requestId,
    ).not.toBe(second.requestId);
  });
  it("aborts pending starts on identity invalidation", async () => {
    vi.mocked(api.createOrResumeSession).mockImplementation(
      () => new Promise(() => {}),
    );
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Start playlist/ }));
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(vi.mocked(api.createOrResumeSession).mock.calls[0][1]?.aborted).toBe(
      true,
    );
    expect(router.push).not.toHaveBeenCalled();
  });
  it("takes a completed playlist to its latest preview before any new run", async () => {
    const saved = playlistSession();
    Object.assign(saved, snapshot("completed"), {
      target: saved.target,
      playlist: saved.playlist,
    });
    const { result } = renderHook(() => useChallengeSession(saved, viewer.id));
    await act(() => result.current.createNextSession());
    expect(router.push).toHaveBeenCalledWith(
      `/library/playlists/${playlistId}`,
    );
    expect(api.createOrResumeSession).not.toHaveBeenCalled();
  });
  it("renders twenty recap positions and original public credit", () => {
    const saved = snapshot("completed");
    const completed = Array.from({ length: 20 }, (_, index) => ({
      ...saved.items[index % 3],
      id: `saved-item-${index}`,
      position: index,
      challenge: { ...saved.items[index % 3].challenge, id: `recap-${index}` },
    }));
    render(
      <SessionRecap
        items={completed}
        sessionId={saved.id}
        viewerId={viewer.id}
        onRestart={vi.fn()}
        title="Saved playlist title"
        playlist={{
          publicationVersion: publicationId,
          credit,
          players: playlistSession().playlist!.players,
        }}
      />,
    );
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText("020")).not.toBeInTheDocument();
    expect(screen.getByText(/Playlist by Coach Example/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /View latest playlist/ }),
    ).toBeInTheDocument();
  });
});
