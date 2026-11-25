import type { VideoLimits } from "@/contracts/video";

export const VIDEO_LIMITS: VideoLimits = {
  maxFileBytes: 2 * 1024 ** 3,
  maxDurationSeconds: 7200,
  maxWidth: 1920,
  maxHeight: 1080,
  maxPendingUploads: 3,
  maxOwnerBytes: 10 * 1024 ** 3,
};
export const VIDEO_CHUNK_BYTES = 6 * 1024 ** 2;
export const VIDEO_FINGERPRINT_CHUNK_BYTES = 4 * 1024 ** 2;
export function validateUploadSelection(file: {
  name: string;
  size: number;
  type: string;
}): string[] {
  const errors: string[] = [];
  if (
    !file.name.trim() ||
    file.name.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(file.name)
  )
    errors.push(
      "Use a filename of 1–255 characters without control characters.",
    );
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > VIDEO_LIMITS.maxFileBytes
  )
    errors.push("Choose a nonempty video no larger than 2 GiB.");
  if (
    !/\.mp4$/i.test(file.name) ||
    (file.type !== "video/mp4" && file.type !== "")
  )
    errors.push(
      "Choose an MP4 video with H.264 video and AAC audio, or no audio.",
    );
  return errors;
}
export function formatUploadLimit(bytes: number): string {
  return bytes >= 1024 ** 3
    ? `${Number((bytes / 1024 ** 3).toFixed(1))} GiB`
    : `${Number((bytes / 1024 ** 2).toFixed(1))} MiB`;
}
