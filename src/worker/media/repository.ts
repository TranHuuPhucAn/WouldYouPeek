import { createClient } from "@supabase/supabase-js";
import type { MediaWorkerConfig } from "./config";
import {
  validateStoredObject,
  type ValidatedVideoMetadata,
  type VideoValidationClaim,
} from "./probe";

export type MediaValidatorRepository = {
  heartbeat(): Promise<boolean>;
  claimVideo(): Promise<VideoValidationClaim | null>;
  renewLease(claim: VideoValidationClaim): Promise<boolean>;
  signVideo(claim: VideoValidationClaim): Promise<string>;
  completeValidation(
    claim: VideoValidationClaim,
    metadata: ValidatedVideoMetadata,
  ): Promise<boolean>;
  failValidation(
    claim: VideoValidationClaim,
    code: string,
    retryable: boolean,
  ): Promise<boolean>;
};

export class MediaRepositoryError extends Error {
  constructor() {
    super("The local media validation service is unavailable.");
  }
}

export function createMediaValidatorRepository(
  config: MediaWorkerConfig,
): MediaValidatorRepository {
  const client = createClient(config.apiUrl, config.publishableKey, {
    global: {
      headers: { Authorization: `Bearer ${config.validatorToken}` },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        }),
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new MediaRepositoryError();
    return data as unknown;
  }
  async function booleanRpc(name: string, args: Record<string, unknown> = {}) {
    const data = await rpc(name, args);
    if (typeof data !== "boolean") throw new MediaRepositoryError();
    return data;
  }
  const identity = (claim: VideoValidationClaim) => ({
    p_asset_id: claim.assetId,
    p_fence: claim.fence,
  });
  return {
    heartbeat: () => booleanRpc("report_video_validator_heartbeat"),
    async claimVideo() {
      const data = await rpc("claim_video_validation");
      return data === null ? null : validateStoredObject(data);
    },
    renewLease: (claim) =>
      booleanRpc("renew_video_validation_lease", identity(claim)),
    async signVideo(claim) {
      const { data, error } = await client.storage
        .from(claim.bucket)
        .createSignedUrl(claim.objectPath, 120);
      if (error || !data?.signedUrl) throw new MediaRepositoryError();
      return data.signedUrl;
    },
    completeValidation: (claim, metadata) =>
      booleanRpc("complete_video_validation", {
        ...identity(claim),
        p_object_version: claim.objectVersion,
        p_metadata: metadata,
      }),
    failValidation: (claim, code, retryable) =>
      booleanRpc("fail_video_validation", {
        ...identity(claim),
        p_code: code,
        p_retryable: retryable,
      }),
  };
}
