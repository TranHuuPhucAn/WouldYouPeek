import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/client/api-response";
import { useVideoUpload } from "@/hooks/use-video-upload";
import * as api from "@/lib/client/video-api";
import * as transport from "@/lib/video/upload-transport";
import {
  videoSnapshot,
  uploadDescriptor,
  OWNER_ID,
  VIDEO_ID,
} from "./video-fixtures";
vi.mock("@/lib/client/video-api");
vi.mock("@/lib/video/upload-transport");
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: () =>
    window.dispatchEvent(new Event("wyp:identity-invalidated")),
}));
const transfer = {
  start: vi.fn(),
  pause: vi.fn(async () => {}),
  abort: vi.fn(async () => {}),
};
const file = () => new File(["abcdef"], "recording.mp4", { type: "video/mp4" });
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.mocked(transport.fingerprintVideo).mockResolvedValue("a".repeat(64));
  vi.mocked(transport.createUploadTransport).mockResolvedValue(transfer);
  vi.mocked(api.createCreatorVideo).mockResolvedValue({
    video: videoSnapshot(),
    replayed: false,
  });
  vi.mocked(api.getUploadSession).mockResolvedValue({
    video: videoSnapshot(),
    upload: uploadDescriptor(),
  });
});
describe("resumable creator uploads", () => {
  it("reserves once, uploads directly, and confirms completion before showing file checking", async () => {
    vi.mocked(api.completeCreatorVideo).mockResolvedValue({
      video: videoSnapshot({
        revision: 2,
        state: "uploaded",
        actualByteSize: 6,
      }),
      replayed: false,
    });
    const changed = vi.fn();
    const { result } = renderHook(() => useVideoUpload(OWNER_ID, changed));
    await act(async () => {
      await result.current.start(file());
    });
    expect(result.current.stage).toBe("uploading");
    expect(transfer.start).toHaveBeenCalledOnce();
    expect(api.createCreatorVideo).toHaveBeenCalledOnce();
    expect(sessionStorage.length).toBe(0);
    const callbacks = vi.mocked(transport.createUploadTransport).mock
      .calls[0][3];
    await act(async () => {
      callbacks.onSuccess();
    });
    expect(result.current.stage).toBe("checking");
    expect(api.completeCreatorVideo).toHaveBeenCalledWith(
      VIDEO_ID,
      expect.objectContaining({ expectedRevision: 1 }),
      expect.any(AbortSignal),
    );
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "uploaded" }),
    );
  });
  it("keeps an unknown reservation's UUID and fingerprint on retry", async () => {
    vi.mocked(api.createCreatorVideo).mockRejectedValueOnce(
      new Error("Connection lost"),
    );
    const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
    await act(async () => {
      await result.current.start(file());
    });
    const original = vi.mocked(api.createCreatorVideo).mock.calls[0][0];
    expect(result.current.hasPendingReservation).toBe(true);
    const recovery = sessionStorage.getItem(
      `wyp:video-reservation:v1:${OWNER_ID}`,
    )!;
    expect(recovery).not.toContain("token");
    expect(recovery).not.toContain("uploadUrl");
    await act(async () => {
      await result.current.start(file());
    });
    expect(vi.mocked(api.createCreatorVideo).mock.calls[1][0]).toEqual(
      original,
    );
    expect(sessionStorage.length).toBe(0);
  });
  it("does not replace a reloaded unknown reservation or accept a different original file", async () => {
    sessionStorage.setItem(
      `wyp:video-reservation:v1:${OWNER_ID}`,
      JSON.stringify({
        version: 1,
        viewerId: OWNER_ID,
        request: {
          requestId: VIDEO_ID,
          fileName: "recording.mp4",
          byteSize: 6,
          mimeType: "video/mp4",
          contentFingerprint: "a".repeat(64),
        },
      }),
    );
    vi.mocked(api.findCreatorVideoByRequestId).mockResolvedValue(null);
    const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
    await waitFor(() => expect(result.current.stage).toBe("error"));
    vi.mocked(transport.fingerprintVideo).mockResolvedValue("b".repeat(64));
    await act(async () => {
      await result.current.start(file());
    });
    expect(result.current.error).toContain("previous reservation");
    expect(api.createCreatorVideo).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.start(file(), videoSnapshot());
    });
    expect(result.current.error).toContain("previous reservation");
    expect(api.getUploadSession).not.toHaveBeenCalled();
  });
  it("reselects an existing file without making another reservation, and pauses locally", async () => {
    const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
    await act(async () => {
      await result.current.start(file(), videoSnapshot());
    });
    expect(api.createCreatorVideo).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.stage).toBe("paused");
    expect(transfer.pause).toHaveBeenCalledOnce();
    expect(api.deleteCreatorVideo).not.toHaveBeenCalled();
  });
  it("keeps the same completion command after an unknown result", async () => {
    vi.mocked(api.completeCreatorVideo)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        video: videoSnapshot({ revision: 2, state: "uploaded" }),
        replayed: true,
      });
    vi.mocked(api.getCreatorVideo).mockResolvedValue(videoSnapshot());
    const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
    await act(async () => {
      await result.current.start(file());
    });
    await act(async () => {
      vi.mocked(transport.createUploadTransport).mock.calls[0][3].onSuccess();
    });
    expect(result.current.stage).toBe("error");
    await act(async () => {
      await result.current.retryComplete();
    });
    expect(vi.mocked(api.completeCreatorVideo).mock.calls[1][1]).toEqual(
      vi.mocked(api.completeCreatorVideo).mock.calls[0][1],
    );
    expect(result.current.stage).toBe("checking");
  });
  it("keeps deletion retry identity until removal is confirmed and aborts on identity changes", async () => {
    vi.mocked(api.deleteCreatorVideo)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        video: videoSnapshot({ revision: 3, state: "deleted" }),
        replayed: true,
      });
    const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
    await act(async () => {
      await result.current.start(file());
      await result.current.cancel();
    });
    expect(result.current.video).not.toBeNull();
    await act(async () => {
      await result.current.cancel();
    });
    expect(vi.mocked(api.deleteCreatorVideo).mock.calls[1][1]).toEqual(
      vi.mocked(api.deleteCreatorVideo).mock.calls[0][1],
    );
    expect(result.current.video).toBeNull();
    await act(async () => {
      await result.current.start(file());
    });
    act(() => window.dispatchEvent(new Event("wyp:identity-invalidated")));
    expect(result.current.invalid).toBe(true);
    expect(result.current.video).toBeNull();
    expect(transfer.abort).toHaveBeenCalled();
  });
});

it("reconciles a definite cancellation revision conflict before creating a fresh retry command", async () => {
  vi.mocked(api.deleteCreatorVideo)
    .mockRejectedValueOnce(
      new ApiClientError("REVISION_CONFLICT", "Recording changed", 409),
    )
    .mockResolvedValueOnce({
      video: videoSnapshot({ revision: 4, state: "deleted" }),
      replayed: false,
    });
  vi.mocked(api.getCreatorVideo).mockResolvedValue(
    videoSnapshot({ revision: 3, state: "uploaded" }),
  );
  const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
  await act(async () => {
    await result.current.start(file());
  });
  await act(async () => {
    await result.current.cancel();
  });
  expect(result.current.video?.revision).toBe(3);
  await act(async () => {
    await result.current.cancel();
  });
  expect(
    vi.mocked(api.deleteCreatorVideo).mock.calls[1][1].expectedRevision,
  ).toBe(3);
  expect(vi.mocked(api.deleteCreatorVideo).mock.calls[1][1].requestId).not.toBe(
    vi.mocked(api.deleteCreatorVideo).mock.calls[0][1].requestId,
  );
});
it("ignores duplicate starts while a transfer is already running", async () => {
  const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
  await act(async () => {
    await result.current.start(file());
    await result.current.start(file());
  });
  expect(transport.createUploadTransport).toHaveBeenCalledOnce();
  expect(api.createCreatorVideo).toHaveBeenCalledOnce();
});

it("starts a fresh reservation after cancelling an upload recovered across reload", async () => {
  sessionStorage.setItem(
    `wyp:video-reservation:v1:${OWNER_ID}`,
    JSON.stringify({
      version: 1,
      viewerId: OWNER_ID,
      request: {
        requestId: VIDEO_ID,
        fileName: "recording.mp4",
        byteSize: 6,
        mimeType: "video/mp4",
        contentFingerprint: "a".repeat(64),
      },
    }),
  );
  vi.mocked(api.findCreatorVideoByRequestId).mockResolvedValue(videoSnapshot());
  vi.mocked(api.deleteCreatorVideo).mockResolvedValue({
    video: videoSnapshot({ revision: 2, state: "deleted" }),
    replayed: false,
  });
  const { result } = renderHook(() => useVideoUpload(OWNER_ID, vi.fn()));
  await waitFor(() => expect(result.current.stage).toBe("paused"));
  await act(async () => {
    await result.current.cancel();
  });
  expect(result.current.stage).toBe("idle");
  const next = videoSnapshot({
    id: "82300000-0000-4000-8000-000000000003",
    fileName: "another.mp4",
  });
  vi.mocked(api.createCreatorVideo).mockResolvedValue({
    video: next,
    replayed: false,
  });
  vi.mocked(api.getUploadSession).mockResolvedValue({
    video: next,
    upload: {
      ...uploadDescriptor(),
      assetId: next.id,
      objectPath: `${OWNER_ID}/${next.id}/source.mp4`,
    },
  });
  await act(async () => {
    await result.current.start(
      new File(["abcdef"], "another.mp4", { type: "video/mp4" }),
    );
  });
  expect(api.createCreatorVideo).toHaveBeenCalledOnce();
  expect(vi.mocked(api.createCreatorVideo).mock.calls[0][0].requestId).not.toBe(
    VIDEO_ID,
  );
  expect(vi.mocked(api.createCreatorVideo).mock.calls[0][0].fileName).toBe(
    "another.mp4",
  );
  expect(result.current.stage).toBe("uploading");
});
