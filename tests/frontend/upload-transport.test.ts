import { webcrypto, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fingerprintVideo,
  createUploadTransport,
} from "@/lib/video/upload-transport";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { VIDEO_FINGERPRINT_CHUNK_BYTES } from "@/lib/video/upload-policy";
import { OWNER_ID, uploadDescriptor } from "./video-fixtures";
const captured = vi.hoisted(() => ({
  options: null as unknown as import("tus-js-client").UploadOptions,
  start: vi.fn(),
  abort: vi.fn(async () => {}),
}));
vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_file: File, options: import("tus-js-client").UploadOptions) {
      captured.options = options;
    }
    start = captured.start;
    abort = captured.abort;
  },
}));
vi.mock("@/lib/supabase/browser");
vi.mock("@/components/auth/AuthStateSync", () => ({
  invalidateAccountView: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
});
afterEach(() => vi.unstubAllEnvs());
describe("bounded upload identity and authenticated TUS transport", () => {
  it("hashes every byte including middle chunks, and supports abort without reading all bytes into memory", async () => {
    const data = new Uint8Array(VIDEO_FINGERPRINT_CHUNK_BYTES * 2 + 3);
    data.fill(2);
    const progress = vi.fn();
    const file = new File([data], "recording.mp4");
    const digests = [];
    for (
      let offset = 0;
      offset < data.length;
      offset += VIDEO_FINGERPRINT_CHUNK_BYTES
    )
      digests.push(
        createHash("sha256")
          .update(data.slice(offset, offset + VIDEO_FINGERPRINT_CHUNK_BYTES))
          .digest(),
      );
    expect(await fingerprintVideo(file, undefined, progress)).toBe(
      createHash("sha256").update(Buffer.concat(digests)).digest("hex"),
    );
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(data.length);
    data[VIDEO_FINGERPRINT_CHUNK_BYTES + 8] = 3;
    expect(await fingerprintVideo(new File([data], "recording.mp4"))).not.toBe(
      await fingerprintVideo(file),
    );
    const abort = new AbortController();
    abort.abort();
    await expect(fingerprintVideo(file, abort.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
  it("resumes only the server session, fetches current credentials per request, and stores no local capabilities", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: { id: OWNER_ID },
          access_token: "current-user-token",
        },
      },
      error: null,
    });
    vi.mocked(createBrowserSupabaseClient).mockReturnValue({
      auth: { getSession },
    } as unknown as ReturnType<typeof createBrowserSupabaseClient>);
    const callbacks = {
      onProgress: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };
    const transfer = await createUploadTransport(
      new File(["abcdef"], "recording.mp4"),
      uploadDescriptor(),
      OWNER_ID,
      callbacks,
    );
    expect(captured.options).toMatchObject({
      uploadUrl: uploadDescriptor().uploadUrl,
      storeFingerprintForResuming: false,
      chunkSize: 6 * 1024 ** 2,
    });
    const request = { setHeader: vi.fn() };
    await captured.options.onBeforeRequest!(request as never);
    expect(request.setHeader).toHaveBeenCalledWith(
      "authorization",
      "Bearer current-user-token",
    );
    getSession.mockResolvedValue({
      data: { session: { user: { id: "other" }, access_token: "other-token" } },
      error: null,
    });
    await expect(
      captured.options.onBeforeRequest!(request as never),
    ).rejects.toThrow("authentication changed");
    transfer.start();
    expect(captured.start).toHaveBeenCalled();
    await transfer.pause();
    expect(captured.abort).toHaveBeenCalledWith(false);
    captured.options.onSuccess!({} as never);
    expect(callbacks.onSuccess).not.toHaveBeenCalled();
    transfer.start();
    captured.options.onError!(new Error("private storage capability") as never);
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.not.stringContaining("capability"),
    );
  });
});

it("refuses a server session whose owner path or declared size differs", async () => {
  const file = new File(["abcdef"], "recording.mp4");
  const callbacks = {
    onProgress: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
  };
  await expect(
    createUploadTransport(
      file,
      {
        ...uploadDescriptor(),
        objectPath: `other/${uploadDescriptor().assetId}/source.mp4`,
      },
      OWNER_ID,
      callbacks,
    ),
  ).rejects.toThrow("does not match");
  await expect(
    createUploadTransport(
      file,
      { ...uploadDescriptor(), byteSize: 7 },
      OWNER_ID,
      callbacks,
    ),
  ).rejects.toThrow("does not match");
});
