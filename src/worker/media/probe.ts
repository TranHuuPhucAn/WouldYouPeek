import { spawn } from "node:child_process";
import type { MediaWorkerConfig } from "./config";

export type ValidatedVideoMetadata = {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: "h264";
  pixelFormat: "yuv420p";
  audioCodec: "aac" | null;
};
export type VideoValidationClaim = {
  assetId: string;
  fence: string;
  bucket: "creator-vods";
  objectPath: string;
  objectVersion: string;
  byteSize: number;
  leaseExpiresAt: string;
};
export class MediaProbeError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
  ) {
    super(code);
    this.name = "MediaProbeError";
  }
}
const MAX_BYTES = 2 * 1024 ** 3;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function validateStoredObject(value: unknown): VideoValidationClaim {
  if (
    !record(value) ||
    typeof value.assetId !== "string" ||
    !uuid.test(value.assetId) ||
    typeof value.fence !== "string" ||
    !uuid.test(value.fence) ||
    value.bucket !== "creator-vods" ||
    typeof value.objectPath !== "string" ||
    !new RegExp(`^[0-9a-f-]{36}/${value.assetId}/source\\.mp4$`, "i").test(
      value.objectPath,
    ) ||
    !uuid.test(value.objectPath.split("/")[0]) ||
    typeof value.objectVersion !== "string" ||
    !value.objectVersion ||
    value.objectVersion.length > 200 ||
    !Number.isSafeInteger(value.byteSize) ||
    Number(value.byteSize) <= 0 ||
    Number(value.byteSize) > MAX_BYTES ||
    typeof value.leaseExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.leaseExpiresAt))
  )
    throw new MediaProbeError("MEDIA_SOURCE_UNAVAILABLE", true);
  return value as VideoValidationClaim;
}

export function parseProbeResult(
  raw: string | unknown,
  expectedBytes: number,
): ValidatedVideoMetadata {
  let input: unknown;
  try {
    input = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new MediaProbeError("VIDEO_UNSUPPORTED", false);
  }
  if (!record(input) || !record(input.format) || !Array.isArray(input.streams))
    throw new MediaProbeError("VIDEO_UNSUPPORTED", false);
  const format = input.format;
  const video = input.streams.filter(
    (stream) => record(stream) && stream.codec_type === "video",
  );
  const audio = input.streams.filter(
    (stream) => record(stream) && stream.codec_type === "audio",
  );
  const duration = Number(format.duration),
    bytes = Number(format.size);
  const brand = record(format.tags)
    ? String(format.tags.major_brand ?? "").trim()
    : "";
  if (
    video.length !== 1 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 7200 ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    expectedBytes > MAX_BYTES ||
    !Number.isSafeInteger(bytes) ||
    bytes !== expectedBytes ||
    typeof format.format_name !== "string" ||
    !format.format_name.split(",").includes("mp4") ||
    !/^(isom|iso[2-9]|mp4[12]|avc1|M4V|dash)$/.test(brand)
  )
    throw new MediaProbeError("VIDEO_UNSUPPORTED", false);
  const stream = video[0];
  if (
    stream.codec_name !== "h264" ||
    stream.pix_fmt !== "yuv420p" ||
    !Number.isInteger(stream.width) ||
    !Number.isInteger(stream.height) ||
    stream.width < 1 ||
    stream.width > 1920 ||
    stream.height < 1 ||
    stream.height > 1080 ||
    (record(stream.disposition) && stream.disposition.attached_pic === 1) ||
    audio.some((track) => track.codec_name !== "aac")
  )
    throw new MediaProbeError("VIDEO_UNSUPPORTED", false);
  return {
    durationSeconds: duration,
    width: stream.width,
    height: stream.height,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: audio.length ? "aac" : null,
  };
}

export function validateProbeUrl(
  raw: string,
  config: MediaWorkerConfig,
  claim: VideoValidationClaim,
) {
  validateStoredObject(claim);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MediaProbeError("MEDIA_SOURCE_UNAVAILABLE", true);
  }
  const expectedPath = `/storage/v1/object/sign/${claim.bucket}/${claim.objectPath}`;
  if (
    url.origin !== new URL(config.apiUrl).origin ||
    url.pathname !== expectedPath ||
    url.username ||
    url.password ||
    url.hash ||
    !url.searchParams.get("token") ||
    [...url.searchParams.keys()].some((key) => key !== "token") ||
    url.searchParams.getAll("token").length !== 1 ||
    raw.length > 8192
  )
    throw new MediaProbeError("MEDIA_SOURCE_UNAVAILABLE", true);
  return url.href;
}

export function probeVideo(
  config: MediaWorkerConfig,
  claim: VideoValidationClaim,
  signedUrl: string,
  {
    signal,
    execute = spawn,
    timeoutMs = 45_000,
  }: { signal?: AbortSignal; execute?: typeof spawn; timeoutMs?: number } = {},
): Promise<ValidatedVideoMetadata> {
  const url = validateProbeUrl(signedUrl, config, claim);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-protocol_whitelist",
      "http,https,tcp,tls",
      "-rw_timeout",
      "10000000",
      "-probesize",
      "10000000",
      "-analyzeduration",
      "10000000",
      "-max_alloc",
      "67108864",
      "-threads",
      "1",
      "-f",
      "mov",
      "-enable_drefs",
      "0",
      "-use_absolute_path",
      "0",
      "-show_entries",
      "format=format_name,duration,size:format_tags=major_brand:stream=codec_name,codec_type,width,height,pix_fmt:stream_disposition=attached_pic",
      "-of",
      "json",
      "-i",
      url,
    ];
    const child = execute(config.ffprobePath, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        LC_ALL: "C",
        NODE_ENV: "production",
      },
    });
    let stdout = "",
      stderr = "",
      size = 0,
      reason: MediaProbeError | null = null,
      settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: MediaProbeError) => {
      if (reason || settled) return;
      reason = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
      killTimer.unref();
    };
    const onAbort = () =>
      stop(new MediaProbeError("MEDIA_VALIDATOR_STOPPED", true));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => stop(new MediaProbeError("MEDIA_PROBE_TIMEOUT", true)),
      timeoutMs,
    );
    timer.unref();
    const finish = (error?: unknown, metadata?: ValidatedVideoMetadata) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(metadata!);
    };
    const collect = (chunk: Buffer, stream: "stdout" | "stderr") => {
      size += chunk.length;
      if (size > 64 * 1024) {
        stop(new MediaProbeError("VIDEO_UNSUPPORTED", false));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    child.on("error", () =>
      finish(new MediaProbeError("MEDIA_PROBE_FAILED", true)),
    );
    child.on("close", (code) => {
      if (reason) return finish(reason);
      if (code !== 0)
        return finish(
          new MediaProbeError(
            /HTTP error|Connection refused|Connection timed out|Server returned|Network is unreachable/.test(
              stderr,
            )
              ? "MEDIA_SOURCE_UNAVAILABLE"
              : "VIDEO_UNSUPPORTED",
            /HTTP error|Connection refused|Connection timed out|Server returned|Network is unreachable/.test(
              stderr,
            ),
          ),
        );
      try {
        finish(undefined, parseProbeResult(stdout, claim.byteSize));
      } catch (error) {
        finish(error);
      }
    });
  });
}
