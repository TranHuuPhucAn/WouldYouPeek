import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertValidatorIdentity,
  loadMediaWorkerConfig,
  type MediaWorkerConfig,
} from "./config";
import { MediaProbeError, probeVideo } from "./probe";
import {
  createMediaValidatorRepository,
  type MediaValidatorRepository,
} from "./repository";

type ValidatorOptions = {
  config: MediaWorkerConfig;
  repository?: MediaValidatorRepository;
  probe?: typeof probeVideo;
  signal?: AbortSignal;
  heartbeatMs?: number;
  log?: (message: string) => void;
};

export async function validateNextAsset({
  config,
  repository = createMediaValidatorRepository(config),
  probe = probeVideo,
  signal,
  heartbeatMs = 30_000,
  log = console.log,
}: ValidatorOptions): Promise<boolean> {
  signal?.throwIfAborted();
  assertValidatorIdentity(config.validatorToken, config.projectId);
  const claim = await repository.claimVideo();
  if (!claim) return false;
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  let ownsLease = true,
    renewing = false;
  const timer = setInterval(async () => {
    if (renewing || !ownsLease) return;
    renewing = true;
    try {
      assertValidatorIdentity(config.validatorToken, config.projectId);
      if (!(await repository.renewLease(claim))) ownsLease = false;
    } catch {
      ownsLease = false;
    } finally {
      renewing = false;
      if (!ownsLease) controller.abort();
    }
  }, heartbeatMs);
  timer.unref();
  try {
    const url = await repository.signVideo(claim);
    controller.signal.throwIfAborted();
    const metadata = await probe(config, claim, url, {
      signal: controller.signal,
    });
    if (!ownsLease || controller.signal.aborted) return true;
    if (await repository.completeValidation(claim, metadata))
      log("Uploaded video validated.");
  } catch (error) {
    if (ownsLease) {
      const failure =
        error instanceof MediaProbeError
          ? error
          : new MediaProbeError(
              controller.signal.aborted
                ? "MEDIA_VALIDATOR_STOPPED"
                : "MEDIA_PROBE_FAILED",
              true,
            );
      // A failed finalization retains its lease for safe expiry/reclaim. Never print provider stderr or URLs.
      await repository.failValidation(claim, failure.code, failure.retryable);
      if (!controller.signal.aborted)
        log(
          failure.retryable
            ? "Video validation needs a retry."
            : "Uploaded video does not meet the supported format limits.",
        );
    }
  } finally {
    clearInterval(timer);
    signal?.removeEventListener("abort", stop);
  }
  return true;
}

export async function runMediaValidator({
  config,
  repository = createMediaValidatorRepository(config),
  signal,
  probe = probeVideo,
  once = false,
  pollMs = 1500,
  log = console.log,
}: ValidatorOptions & { once?: boolean; pollMs?: number }) {
  let lastHeartbeat = 0,
    failures = 0,
    ready = false;
  while (!signal?.aborted) {
    assertValidatorIdentity(config.validatorToken, config.projectId);
    try {
      if (Date.now() - lastHeartbeat >= 30_000) {
        if (!(await repository.heartbeat()))
          throw new Error("Validator heartbeat refused.");
        lastHeartbeat = Date.now();
      }
      const worked = await validateNextAsset({
        config,
        repository,
        signal,
        probe,
        log,
      });
      failures = 0;
      if (!ready) {
        ready = true;
        log("[media] Validator ready");
      }
      if (once) return;
      if (worked) continue;
    } catch {
      if (signal?.aborted) return;
      failures += 1;
      log("Local video validation is temporarily unavailable.");
      if (once || failures >= 5)
        throw new Error(
          "Local media validator stopped after repeated service failures.",
        );
    }
    try {
      await delay(failures ? Math.max(5000, pollMs) : pollMs, undefined, {
        signal,
      });
    } catch {
      if (signal?.aborted) return;
      throw new Error("Local media validator wait failed.");
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const args = process.argv.slice(2);
    if (
      args.length < 2 ||
      args[0] !== "--config" ||
      args.length > 3 ||
      (args[2] && args[2] !== "--once")
    )
      throw new Error("Use npm run media:worker to start the local validator.");
    const config = loadMediaWorkerConfig(args[1]);
    await runMediaValidator({
      config,
      signal: controller.signal,
      once: args[2] === "--once",
    });
  } catch {
    console.error(
      "The local media validator could not continue. Check local services, ffprobe, and npm run media:setup.",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
