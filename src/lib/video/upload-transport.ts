import type { VideoUploadDescriptor } from "@/contracts/video";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import {
  VIDEO_CHUNK_BYTES,
  VIDEO_FINGERPRINT_CHUNK_BYTES,
} from "./upload-policy";
import { storageUrl } from "@/lib/client/video-validation";
import { invalidateAccountView } from "@/components/auth/AuthStateSync";

export type UploadTransport = {
  start(): void;
  pause(): Promise<void>;
  abort(): Promise<void>;
};

async function readChunk(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () =>
      reject(new Error("The selected file could not be read."));
    reader.readAsArrayBuffer(blob);
  });
}

/** Hash every byte with bounded memory; the server uses this only for resume identity. */
export async function fingerprintVideo(
  file: File,
  signal?: AbortSignal,
  progress?: (bytes: number) => void,
): Promise<string> {
  if (!crypto.subtle)
    throw new Error(
      "File checks require a secure browser connection. Use localhost or HTTPS.",
    );
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error("Choose a nonempty recording.");
  const digests = new Uint8Array(
    Math.ceil(file.size / VIDEO_FINGERPRINT_CHUNK_BYTES) * 32,
  );
  let index = 0;
  for (
    let offset = 0;
    offset < file.size;
    offset += VIDEO_FINGERPRINT_CHUNK_BYTES
  ) {
    signal?.throwIfAborted();
    const bytes = await readChunk(
      file.slice(offset, offset + VIDEO_FINGERPRINT_CHUNK_BYTES),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    signal?.throwIfAborted();
    digests.set(digest, index++ * 32);
    progress?.(Math.min(file.size, offset + VIDEO_FINGERPRINT_CHUNK_BYTES));
  }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", digests))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createUploadTransport(
  file: File,
  descriptor: VideoUploadDescriptor,
  viewerId: string,
  callbacks: {
    onProgress(bytes: number, total: number): void;
    onSuccess(): void;
    onError(message: string): void;
  },
): Promise<UploadTransport> {
  if (
    descriptor.bucket !== "creator-vods" ||
    descriptor.objectPath !== `${viewerId}/${descriptor.assetId}/source.mp4` ||
    descriptor.byteSize !== file.size ||
    descriptor.mimeType !== "video/mp4"
  )
    throw new Error("The upload session does not match this recording.");
  storageUrl(descriptor.endpoint, "/storage/v1/upload/resumable");
  storageUrl(descriptor.uploadUrl, "/storage/v1/upload/resumable/");
  const { Upload } = await import("tus-js-client");
  let stopped = false;
  const upload = new Upload(file, {
    uploadUrl: descriptor.uploadUrl,
    endpoint: descriptor.endpoint,
    uploadSize: file.size,
    chunkSize: VIDEO_CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000],
    storeFingerprintForResuming: false,
    removeFingerprintOnSuccess: true,
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
    onBeforeRequest: async (request) => {
      const { data, error } =
        await createBrowserSupabaseClient().auth.getSession();
      if (stopped) throw new Error("Upload paused.");
      if (error || !data.session || data.session.user.id !== viewerId) {
        invalidateAccountView();
        throw new Error("Upload authentication changed.");
      }
      request.setHeader("authorization", `Bearer ${data.session.access_token}`);
    },
    onProgress: (bytes, total) => {
      if (!stopped && Number.isFinite(bytes) && total === file.size)
        callbacks.onProgress(Math.max(0, Math.min(bytes, total)), total);
    },
    onSuccess: () => {
      if (!stopped) callbacks.onSuccess();
    },
    onError: () => {
      if (!stopped)
        callbacks.onError(
          "The upload was interrupted. Resume to continue the same recording.",
        );
    },
  });
  return {
    start() {
      stopped = false;
      upload.start();
    },
    async pause() {
      stopped = true;
      await upload.abort(false);
    },
    async abort() {
      stopped = true;
      await upload.abort(false);
    },
  };
}
