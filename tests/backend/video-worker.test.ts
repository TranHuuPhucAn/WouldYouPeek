import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { spawn } from "node:child_process";
import { mintScopedValidatorToken } from "../../scripts/local-media-worker.mjs";
import {
  assertValidatorIdentity,
  loadMediaWorkerConfig,
  validateMediaWorkerConfig,
  type MediaWorkerConfig,
} from "@/worker/media/config";
import {
  MediaProbeError,
  parseProbeResult,
  probeVideo,
  validateProbeUrl,
  validateStoredObject,
  type ValidatedVideoMetadata,
  type VideoValidationClaim,
} from "@/worker/media/probe";
import { runMediaValidator, validateNextAsset } from "@/worker/media/main";
import type { MediaValidatorRepository } from "@/worker/media/repository";

const secret = "fixture-local-signing-secret-not-a-real-key-000000";
const assetId = "ba8d1859-9fe9-41b3-b656-4fedc217348e";
const ownerId = "1d262bf5-a86c-4053-a80c-d3f9054220f0";
const fence = "d50f2748-1f5b-4326-90b2-0fb821612a09";
const claim: VideoValidationClaim = {
  assetId,
  fence,
  bucket: "creator-vods",
  objectPath: `${ownerId}/${assetId}/source.mp4`,
  objectVersion: "version-one",
  byteSize: 4000,
  leaseExpiresAt: "2026-11-20T00:02:00.000Z",
};
const config = (): MediaWorkerConfig => ({
  schemaVersion: 1,
  projectId: "would-you-peek",
  apiUrl: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_fixture",
  validatorToken: mintScopedValidatorToken(secret, "would-you-peek"),
  ffprobePath: "ffprobe",
});
const rawProbe = (): {
  format: {
    format_name: string;
    duration: string;
    size: string;
    tags: { major_brand: string };
  };
  streams: Record<string, unknown>[];
} => ({
  format: {
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: "15.0",
    size: "4000",
    tags: { major_brand: "isom" },
  },
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 640,
      height: 360,
      pix_fmt: "yuv420p",
      disposition: { attached_pic: 0 },
    },
    { codec_type: "audio", codec_name: "aac" },
  ],
});
const signed = () =>
  `${config().apiUrl}/storage/v1/object/sign/creator-vods/${claim.objectPath}?token=opaque-token`;
const metadata = {
  durationSeconds: 15,
  width: 640,
  height: 360,
  videoCodec: "h264" as const,
  pixelFormat: "yuv420p" as const,
  audioCodec: "aac" as const,
};
const repository = (): MediaValidatorRepository => ({
  heartbeat: vi.fn().mockResolvedValue(true),
  claimVideo: vi.fn().mockResolvedValue(claim),
  renewLease: vi.fn().mockResolvedValue(true),
  signVideo: vi.fn().mockResolvedValue(signed()),
  completeValidation: vi.fn().mockResolvedValue(true),
  failValidation: vi.fn().mockResolvedValue(true),
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scoped local worker configuration", () => {
  it("accepts the intended local profile and rejects remote, mismatched, or privileged configuration", () => {
    expect(validateMediaWorkerConfig(config()).projectId).toBe(
      "would-you-peek",
    );
    for (const bad of [
      { apiUrl: "https://production.supabase.co" },
      { apiUrl: "http://localhost:55321" },
      { apiUrl: "http://127.0.0.1:54321/other" },
      { projectId: "other-project" },
      { publishableKey: "sb_secret_administrator" },
      { JWT_SECRET: secret },
    ])
      expect(() =>
        validateMediaWorkerConfig({ ...config(), ...bad }),
      ).toThrow();
  });
  it("rejects expired, wrong-role, wrong-project and excessively long-lived tokens", () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = mintScopedValidatorToken(secret, "would-you-peek", {
      now: now - 30_000,
    });
    expect(() => assertValidatorIdentity(expired, "would-you-peek")).toThrow(
      /expired/,
    );
    const other = mintScopedValidatorToken(
      secret,
      "wyp-test-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaa",
    );
    expect(() => assertValidatorIdentity(other, "would-you-peek")).toThrow();
    const parts = config().validatorToken.split(".");
    for (const change of [
      { role: "service_role" },
      { exp: now + 100_000 },
      { iat: now + 500 },
      { exp: "tomorrow" },
    ]) {
      const claims = {
        ...JSON.parse(Buffer.from(parts[1], "base64url").toString()),
        ...change,
      };
      const token = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${parts[2]}`;
      expect(() => assertValidatorIdentity(token, "would-you-peek")).toThrow();
    }
  });
  it("requires a regular credential file with private permissions", () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "wyp-media-config-")),
    );
    try {
      const path = join(directory, "config.json"),
        link = join(directory, "link.json");
      writeFileSync(path, JSON.stringify(config()), { mode: 0o600 });
      expect(loadMediaWorkerConfig(path).projectId).toBe("would-you-peek");
      symlinkSync(path, link);
      expect(() => loadMediaWorkerConfig(link)).toThrow();
      chmodSync(path, 0o644);
      expect(() => loadMediaWorkerConfig(path)).toThrow(/0600/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("trusted media metadata", () => {
  it("accepts ordinary H.264/AAC and silent MP4, preserving measured dimensions and duration", () => {
    expect(parseProbeResult(JSON.stringify(rawProbe()), 4000)).toEqual(
      metadata,
    );
    const multipleAudio = rawProbe();
    multipleAudio.streams.push({ codec_type: "audio", codec_name: "aac" });
    expect(parseProbeResult(multipleAudio, 4000).audioCodec).toBe("aac");
    const silent = rawProbe();
    silent.streams.pop();
    expect(parseProbeResult(silent, 4000).audioCodec).toBeNull();
  });
  it("rejects codec, container, size, duration, dimension, pixel-format and track-policy violations", () => {
    const values: unknown[] = [];
    for (const change of [
      { duration: "NaN" },
      { duration: "0" },
      { duration: "7200.01" },
      { size: "4001" },
      { format_name: "matroska,webm" },
      { tags: { major_brand: "qt  " } },
    ]) {
      values.push({
        ...rawProbe(),
        format: { ...rawProbe().format, ...change },
      });
    }
    for (const change of [
      { codec_name: "hevc" },
      { pix_fmt: "yuv420p10le" },
      { width: 1921 },
      { height: 1081 },
      { width: 0 },
      { disposition: { attached_pic: 1 } },
    ]) {
      const value = rawProbe();
      value.streams[0] = { ...value.streams[0], ...change };
      values.push(value);
    }
    const unsupportedAudio = rawProbe();
    unsupportedAudio.streams[1].codec_name = "opus";
    values.push(unsupportedAudio);
    const multipleVideo = rawProbe();
    multipleVideo.streams.push(multipleVideo.streams[0]);
    values.push(multipleVideo);
    values.push("not JSON", {}, { streams: [], format: {} });
    for (const value of values)
      expect(() => parseProbeResult(value, 4000)).toThrow(MediaProbeError);
    expect(() => parseProbeResult(rawProbe(), 2 * 1024 ** 3 + 1)).toThrow();
  });
  it("binds each probe to the exact recorded asset and signed local Storage path", () => {
    expect(validateStoredObject(claim)).toEqual(claim);
    for (const bad of [
      { objectPath: `../${assetId}/source.mp4` },
      { bucket: "public" },
      { byteSize: 0 },
      { objectVersion: "" },
      { assetId: "not-a-uuid" },
    ])
      expect(() => validateStoredObject({ ...claim, ...bad })).toThrow();
    expect(validateProbeUrl(signed(), config(), claim)).toBe(signed());
    for (const url of [
      signed().replace("127.0.0.1", "evil.test"),
      signed().replace("54321", "55321"),
      signed().replace("source.mp4", "other.mp4"),
      `${signed()}&redirect=https://evil.test`,
      `${signed()}#fragment`,
      "file:///etc/passwd",
      `http://user:secret@127.0.0.1:54321/storage/v1/object/sign/creator-vods/${claim.objectPath}?token=x`,
    ])
      expect(() => validateProbeUrl(url, config(), claim)).toThrow();
  });
});

function fakeProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null));
    return true;
  });
  return child;
}

describe("bounded probe process", () => {
  it("uses explicit MP4 parsing, no shell, minimal protocol access and never returns stderr", async () => {
    const child = fakeProcess();
    const execute = vi.fn(() => child) as unknown as typeof spawn;
    const promise = probeVideo(config(), claim, signed(), { execute });
    child.stdout.write(JSON.stringify(rawProbe()));
    child.emit("close", 0);
    expect(await promise).toEqual(metadata);
    const args = vi.mocked(execute).mock.calls[0][1] as string[];
    expect(args).toContain("mov");
    expect(args).toContain("-enable_drefs");
    expect(args).toContain("-max_alloc");
    expect(vi.mocked(execute).mock.calls[0][2]).toMatchObject({ shell: false });
  });
  it("kills overlong and oversized-output probes and reports only safe codes", async () => {
    vi.useFakeTimers();
    const timed = fakeProcess();
    const timeout = probeVideo(config(), claim, signed(), {
      execute: (() => timed) as unknown as typeof spawn,
      timeoutMs: 100,
    });
    const assertion = expect(timeout).rejects.toMatchObject({
      code: "MEDIA_PROBE_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(timed.kill).toHaveBeenCalledWith("SIGTERM");
    const oversized = fakeProcess();
    const output = probeVideo(config(), claim, signed(), {
      execute: (() => oversized) as unknown as typeof spawn,
    });
    const outputAssertion = expect(output).rejects.toMatchObject({
      code: "VIDEO_UNSUPPORTED",
      retryable: false,
    });
    oversized.stderr.write("private-token".repeat(6000));
    await vi.runAllTicks();
    await outputAssertion;
  });
  it("aborts the owned process on shutdown without exposing the URL", async () => {
    const child = fakeProcess(),
      controller = new AbortController();
    const promise = probeVideo(config(), claim, signed(), {
      signal: controller.signal,
      execute: (() => child) as unknown as typeof spawn,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({
      code: "MEDIA_VALIDATOR_STOPPED",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("leased validation workflow", () => {
  it("announces readiness only after scoped heartbeat and claim RPCs succeed", async () => {
    const repo = repository(),
      log = vi.fn();
    vi.mocked(repo.claimVideo).mockResolvedValue(null);
    await runMediaValidator({
      config: config(),
      repository: repo,
      log,
      once: true,
    });
    expect(repo.heartbeat).toHaveBeenCalledOnce();
    expect(repo.claimVideo).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("[media] Validator ready");
    const refused = repository(),
      failedLog = vi.fn();
    vi.mocked(refused.heartbeat).mockResolvedValue(false);
    await expect(
      runMediaValidator({
        config: config(),
        repository: refused,
        log: failedLog,
        once: true,
      }),
    ).rejects.toThrow(/service failures/);
    expect(refused.claimVideo).not.toHaveBeenCalled();
    expect(failedLog).not.toHaveBeenCalledWith("[media] Validator ready");
  });
  it("publishes only probe-verified metadata through the exact claimed fence", async () => {
    const repo = repository(),
      log = vi.fn(),
      probe = vi.fn().mockResolvedValue(metadata);
    expect(
      await validateNextAsset({
        config: config(),
        repository: repo,
        probe,
        log,
      }),
    ).toBe(true);
    expect(repo.completeValidation).toHaveBeenCalledWith(claim, metadata);
    expect(repo.failValidation).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Uploaded video validated.");
  });
  it("keeps malformed content rejected, and unknown infrastructure failure safely retryable", async () => {
    for (const [failure, code, retryable] of [
      [
        new MediaProbeError("VIDEO_UNSUPPORTED", false),
        "VIDEO_UNSUPPORTED",
        false,
      ],
      [new Error("credentials=DO_NOT_PRINT"), "MEDIA_PROBE_FAILED", true],
    ] as const) {
      const repo = repository(),
        log = vi.fn();
      await validateNextAsset({
        config: config(),
        repository: repo,
        probe: vi.fn().mockRejectedValue(failure),
        log,
      });
      expect(repo.failValidation).toHaveBeenCalledWith(claim, code, retryable);
      expect(repo.completeValidation).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain("DO_NOT_PRINT");
    }
  });
  it("never finalizes after the lease is lost during a probe", async () => {
    vi.useFakeTimers();
    const repo = repository();
    vi.mocked(repo.renewLease).mockResolvedValue(false);
    const probe: typeof probeVideo = vi.fn(
      (_config, _claim, _url, options) =>
        new Promise<ValidatedVideoMetadata>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const pending = validateNextAsset({
      config: config(),
      repository: repo,
      probe,
      heartbeatMs: 30,
      log: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(31);
    await pending;
    expect(repo.renewLease).toHaveBeenCalledWith(claim);
    expect(repo.completeValidation).not.toHaveBeenCalled();
    expect(repo.failValidation).not.toHaveBeenCalled();
  });
  it("does no media work when there is no claim, and handles stale completion without a success claim", async () => {
    const repo = repository(),
      probe = vi.fn().mockResolvedValue(metadata),
      log = vi.fn();
    vi.mocked(repo.claimVideo).mockResolvedValueOnce(null);
    expect(
      await validateNextAsset({
        config: config(),
        repository: repo,
        probe,
        log,
      }),
    ).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    vi.mocked(repo.completeValidation).mockResolvedValue(false);
    await validateNextAsset({ config: config(), repository: repo, probe, log });
    expect(log).not.toHaveBeenCalled();
  });
});
