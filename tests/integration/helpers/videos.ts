import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "vitest";
import type { CreatorDraftContent } from "@/contracts/creator";
import type {
  VideoAssetSnapshot,
  VideoMutationResponse,
  VideoUploadDescriptor,
} from "@/contracts/video";
import {
  VIDEO_CHUNK_BYTES,
  VIDEO_FINGERPRINT_CHUNK_BYTES,
} from "@/lib/video/upload-policy";
import type { TestUser } from "./test-users";
import { getLocalTestConfig } from "./local-supabase";
import { rpc, validContent } from "./creator-scenarios";
export async function fixture(name = "with-audio.mp4") {
  return readFile(resolve("test-results/generated-video", name));
}
export function fingerprint(bytes: Buffer) {
  const hashes: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += VIDEO_FINGERPRINT_CHUNK_BYTES)
    hashes.push(
      createHash("sha256")
        .update(bytes.subarray(i, i + VIDEO_FINGERPRINT_CHUNK_BYTES))
        .digest(),
    );
  return createHash("sha256").update(Buffer.concat(hashes)).digest("hex");
}
export function objectPath(user: TestUser, id: string) {
  return `${user.id}/${id}/source.mp4`;
}
export async function reserve(
  user: TestUser,
  bytes: Buffer,
  name = "fixture.mp4",
  requestId = randomUUID(),
) {
  return rpc<VideoMutationResponse>(user.client, "create_creator_video", {
    p_request_id: requestId,
    p_file_name: name,
    p_byte_size: bytes.length,
    p_mime_type: "video/mp4",
    p_content_fingerprint: fingerprint(bytes),
  });
}
export async function uploadHeaders(user: TestUser) {
  const config = getLocalTestConfig(),
    session = await user.client.auth.getSession();
  if (!session.data.session) throw new Error("Fixture session missing");
  return {
    authorization: `Bearer ${session.data.session.access_token}`,
    apikey: config.publishableKey,
    "Tus-Resumable": "1.0.0",
  };
}
export async function initializeTus(
  user: TestUser,
  assetId: string,
): Promise<VideoUploadDescriptor> {
  const config = getLocalTestConfig();
  const start = await rpc<{
    video: VideoAssetSnapshot;
    upload: VideoUploadDescriptor;
    initializationFence: string | null;
  }>(user.client, "get_creator_video_upload_session", { p_asset_id: assetId });
  if (!start.initializationFence) return start.upload;
  const headers = await uploadHeaders(user),
    metadata = Object.entries({
      bucketName: "creator-vods",
      objectName: start.upload.objectPath,
      contentType: "video/mp4",
      cacheControl: "0",
    })
      .map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`)
      .join(",");
  const response = await fetch(`${config.url}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      ...headers,
      "Upload-Length": String(start.video.byteSize),
      "Upload-Metadata": metadata,
      "x-upsert": "false",
    },
  });
  expect(
    response.status,
    `TUS creation failed: ${await response.clone().text()}`,
  ).toBe(201);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const uploadUrl = new URL(location!, config.url).toString();
  expect(new URL(uploadUrl).origin).toBe(new URL(config.url).origin);
  const result = await rpc<{ upload: VideoUploadDescriptor }>(
    user.client,
    "finish_creator_video_upload_session",
    {
      p_asset_id: assetId,
      p_fence: start.initializationFence,
      p_upload_url: uploadUrl,
    },
  );
  return result.upload;
}
export async function patchTus(
  user: TestUser,
  uploadUrl: string,
  bytes: Buffer,
  offset = 0,
  end = bytes.length,
) {
  const response = await fetch(uploadUrl, {
    method: "PATCH",
    headers: {
      ...(await uploadHeaders(user)),
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": String(offset),
    },
    body: new Uint8Array(bytes.subarray(offset, end)),
  });
  expect(
    response.status,
    `TUS PATCH failed: ${await response.clone().text()}`,
  ).toBe(204);
  expect(Number(response.headers.get("upload-offset"))).toBe(end);
}
export async function finishUpload(user: TestUser, video: VideoAssetSnapshot) {
  return rpc<VideoMutationResponse>(
    user.client,
    "complete_creator_video_upload",
    {
      p_asset_id: video.id,
      p_request_id: randomUUID(),
      p_expected_revision: video.revision,
    },
  );
}
export async function waitVideo(
  user: TestUser,
  id: string,
  state: "ready" | "rejected" = "ready",
) {
  const deadline = Date.now() + 25_000;
  let latest: VideoAssetSnapshot | null = null;
  while (Date.now() < deadline) {
    latest = await rpc<VideoAssetSnapshot>(user.client, "get_creator_video", {
      p_asset_id: id,
    });
    if (latest.state === state) return latest;
    if (state === "ready" && latest.state === "rejected")
      throw new Error(`Validator rejected fixture: ${latest.failure?.code}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Validator did not reach ${state}: ${latest?.state}`);
}
export async function uploadReady(user: TestUser, bytes: Buffer) {
  const { video } = await reserve(user, bytes),
    upload = await initializeTus(user, video.id);
  for (let offset = 0; offset < bytes.length; offset += VIDEO_CHUNK_BYTES)
    await patchTus(
      user,
      upload.uploadUrl,
      bytes,
      offset,
      Math.min(offset + VIDEO_CHUNK_BYTES, bytes.length),
    );
  await finishUpload(user, video);
  return waitVideo(user, video.id);
}
export function uploadedContent(assetId: string): CreatorDraftContent {
  const content = validContent(),
    source = content.source;
  if (source.kind === "uploaded") throw new Error("Expected legacy fixture");
  const { url, ...attribution } = source;
  content.source = {
    ...attribution,
    kind: "uploaded",
    assetId,
    creditUrl: url,
  };
  content.media = {
    ...content.media,
    startSeconds: 0,
    decisionSeconds: 7,
    endSeconds: 13,
  };
  return content;
}
