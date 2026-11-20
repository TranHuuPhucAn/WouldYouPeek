import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadedPlayback } from "@/hooks/use-uploaded-playback";
import { getPlaybackAccess } from "@/lib/client/video-api";
import { ApiClientError } from "@/lib/client/api-response";
import { VIDEO_ID } from "./video-fixtures";
import type { PlaybackContext } from "@/contracts/video";
vi.mock("@/lib/client/video-api");
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
const context = { kind: "creator-asset" as const, assetId: VIDEO_ID };
const access = (url = "signed-memory-only") => ({
  assetId: VIDEO_ID,
  url,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPlaybackAccess).mockImplementation(async () => access());
});
afterEach(() => vi.useRealTimers());
describe("private playback authorization lifecycle", () => {
  it("renews a completed-item replay with the exact original item and phase", async () => {
    vi.useFakeTimers();
    const savedContext: PlaybackContext = {
      kind: "session-item",
      sessionId: "saved-session",
      itemId: "original-item",
      phase: "reveal",
    };
    const { result, unmount } = renderHook(() =>
      useUploadedPlayback(savedContext, VIDEO_ID),
    );
    await act(async () => {});
    vi.mocked(getPlaybackAccess).mockResolvedValue(
      access("renewed-saved-item"),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(285_000);
    });
    expect(getPlaybackAccess).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(getPlaybackAccess).mock.calls)
      expect(call.slice(0, 2)).toEqual([savedContext, VIDEO_ID]);
    expect(result.current.access?.url).toBe("renewed-saved-item");
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(getPlaybackAccess).toHaveBeenCalledTimes(2);
  });

  it.each(["item", "phase"] as const)(
    "does not expose a preceding %s capability while the same asset is reauthorized",
    async (change) => {
      let finish!: (value: ReturnType<typeof access>) => void;
      const seen: Array<string | null> = [];
      const { result, rerender } = renderHook(
        ({ itemId, phase }: { itemId: string; phase: "setup" | "reveal" }) => {
          const playback = useUploadedPlayback(
            {
              kind: "session-item",
              sessionId: "session",
              itemId,
              phase,
            },
            VIDEO_ID,
          );
          seen.push(playback.access?.url ?? null);
          return playback;
        },
        { initialProps: { itemId: "first-item", phase: "setup" } },
      );
      await waitFor(() => expect(result.current.access).not.toBeNull());
      vi.mocked(getPlaybackAccess).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      seen.length = 0;
      rerender(
        change === "item"
          ? { itemId: "second-item", phase: "setup" }
          : { itemId: "first-item", phase: "reveal" },
      );
      expect(seen.every((url) => url === null)).toBe(true);
      expect(result.current.access).toBeNull();
      await act(async () => finish(access("second-item-capability")));
      expect(result.current.access?.url).toBe("second-item-capability");
    },
  );

  it("aborts a pending capability on identity invalidation and ignores its eventual result", async () => {
    let finish!: (value: ReturnType<typeof access>) => void;
    vi.mocked(getPlaybackAccess).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const replacing = vi.fn();
    const { result } = renderHook(() =>
      useUploadedPlayback(context, VIDEO_ID, replacing),
    );
    const signal = vi.mocked(getPlaybackAccess).mock.calls[0][2];
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(access("obsolete-account")));
    expect(result.current.access).toBeNull();
    expect(result.current.invalid).toBe(true);
    expect(replacing).toHaveBeenCalledTimes(1);
    await act(async () => result.current.refresh());
    expect(getPlaybackAccess).toHaveBeenCalledTimes(1);
  });

  it("aborts and ignores an authorization finishing after the replay player unmounts", async () => {
    let finish!: (value: ReturnType<typeof access>) => void;
    vi.mocked(getPlaybackAccess).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const replacing = vi.fn();
    const { unmount } = renderHook(() =>
      useUploadedPlayback(context, VIDEO_ID, replacing),
    );
    const signal = vi.mocked(getPlaybackAccess).mock.calls[0][2];
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(access("unmounted")));
    expect(replacing).not.toHaveBeenCalled();
  });

  it("renews in place with exact context and allows positioning to be captured before source replacement", async () => {
    const replacing = vi.fn();
    const { result } = renderHook(() =>
      useUploadedPlayback(context, VIDEO_ID, replacing),
    );
    await waitFor(() =>
      expect(result.current.access?.url).toBe("signed-memory-only"),
    );
    expect(getPlaybackAccess).toHaveBeenCalledWith(
      context,
      VIDEO_ID,
      expect.any(AbortSignal),
    );
    vi.mocked(getPlaybackAccess).mockResolvedValue(access("renewed"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.access?.url).toBe("renewed");
    expect(replacing).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.refresh();
    });
    expect(replacing).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  });
  it("automatically renews 15 seconds before expiry", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useUploadedPlayback(context, VIDEO_ID));
    await act(async () => {});
    expect(result.current.access).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(285_000);
    });
    expect(getPlaybackAccess).toHaveBeenCalledTimes(2);
  });
  it("clears capabilities and stops further fetches on authorization loss", async () => {
    const { result } = renderHook(() => useUploadedPlayback(context, VIDEO_ID));
    await waitFor(() => expect(result.current.access).not.toBeNull());
    vi.mocked(getPlaybackAccess).mockRejectedValue(
      new ApiClientError("AUTH_REQUIRED", "Sign in", 401),
    );
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.invalid).toBe(true);
    expect(result.current.access).toBeNull();
    const calls = vi.mocked(getPlaybackAccess).mock.calls.length;
    await act(async () => {
      await result.current.refresh();
    });
    expect(getPlaybackAccess).toHaveBeenCalledTimes(calls);
  });
  it("ignores obsolete pending authorizations after a phase changes", async () => {
    let resolve!: (value: ReturnType<typeof access>) => void;
    vi.mocked(getPlaybackAccess).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = renderHook(
      ({ phase }: { phase: "setup" | "reveal" }) =>
        useUploadedPlayback(
          {
            kind: "session-item",
            sessionId: VIDEO_ID,
            itemId: VIDEO_ID,
            phase,
          },
          VIDEO_ID,
        ),
      { initialProps: { phase: "setup" } },
    );
    rerender({ phase: "reveal" });
    await waitFor(() =>
      expect(result.current.access?.url).toBe("signed-memory-only"),
    );
    await act(async () => resolve(access("obsolete")));
    expect(result.current.access?.url).toBe("signed-memory-only");
  });
});
