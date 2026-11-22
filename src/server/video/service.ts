import "server-only";
import { requireUploadsEnabled } from "@/server/deployment/capabilities";
import type {
  VideoMutationResponse,
  VideoUploadSessionResponse,
} from "@/contracts/video";
import { requireCreator } from "@/server/auth/guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPublicSupabaseConfig } from "@/server/config";
import { ApiError } from "@/server/http";
import * as repository from "./repository";
import * as validation from "./validation";
import {
  invalidVideoData,
  videoRecord,
  toVideoSnapshot,
  toVideoList,
  toVideoMutation,
  toUploadDescriptor,
  toVideoObject,
} from "./projections";
function mutation(value: unknown, id: string): VideoMutationResponse {
  const m = toVideoMutation(value);
  if (m.video.id !== id) invalidVideoData();
  return m;
}
export async function listVideos(cursor?: string | null) {
  await requireCreator();
  await requireUploadsEnabled();
  return toVideoList(
    await repository.listVideos(validation.parseVideoCursor(cursor)),
  );
}
export async function getVideo(rawId: string) {
  await requireCreator();
  await requireUploadsEnabled();
  const id = validation.parseVideoId(rawId),
    v = toVideoSnapshot(await repository.getVideo(id));
  if (v.id !== id) invalidVideoData();
  return v;
}
export async function createVideo(input: unknown) {
  await requireCreator();
  await requireUploadsEnabled();
  return toVideoMutation(
    await repository.createVideo(validation.parseCreateVideo(input)),
  );
}
export async function findVideoRequest(rawId: string) {
  await requireCreator();
  await requireUploadsEnabled();
  const value = videoRecord(
    await repository.findVideoRequest(validation.parseVideoId(rawId)),
  );
  return { video: value.video === null ? null : toVideoSnapshot(value.video) };
}
export async function completeUpload(rawId: string, input: unknown) {
  await requireCreator();
  await requireUploadsEnabled();
  const id = validation.parseVideoId(rawId);
  return mutation(
    await repository.completeUpload(id, validation.parseVideoCommand(input)),
    id,
  );
}
export async function retryValidation(rawId: string, input: unknown) {
  await requireCreator();
  await requireUploadsEnabled();
  const id = validation.parseVideoId(rawId);
  return mutation(
    await repository.retryValidation(id, validation.parseVideoCommand(input)),
    id,
  );
}
export async function getUploadSession(
  rawId: string,
  input: unknown,
): Promise<VideoUploadSessionResponse> {
  await requireCreator();
  await requireUploadsEnabled();
  validation.parseEmptyVideoCommand(input);
  const id = validation.parseVideoId(rawId),
    config = getPublicSupabaseConfig();
  let raw = videoRecord(await repository.getUploadSession(id));
  const initial = toVideoSnapshot(raw.video);
  if (initial.id !== id) invalidVideoData();
  if (raw.initializationFence !== null) {
    const fence = validation.parseVideoId(raw.initializationFence),
      u = videoRecord(raw.upload);
    try {
      const object = toVideoObject(u);
      if (
        object.assetId !== id ||
        u.byteSize !== initial.byteSize ||
        u.mimeType !== "video/mp4"
      )
        invalidVideoData();
      const client = await createServerSupabaseClient();
      const session = await client.auth.getSession();
      if (session.error || !session.data.session)
        throw new ApiError(
          "AUTH_REQUIRED",
          "Sign in again to continue this upload.",
        );
      const metadata = Object.entries({
        bucketName: object.bucket,
        objectName: object.objectPath,
        contentType: "video/mp4",
        cacheControl: "0",
      })
        .map(
          ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
        )
        .join(",");
      const endpoint = `${config.url}/storage/v1/upload/resumable`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.data.session.access_token}`,
          apikey: config.publishableKey,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(initial.byteSize),
          "Upload-Metadata": metadata,
          "x-upsert": "false",
        },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
        cache: "no-store",
      });
      const location = response.headers.get("location");
      if (response.status !== 201 || !location)
        throw new ApiError(
          "STORAGE_UNAVAILABLE",
          "The upload could not start. Try again.",
        );
      const url = new URL(location, endpoint).toString();
      toUploadDescriptor({ ...u, uploadUrl: url }, config.url);
      raw = videoRecord(await repository.finishUploadSession(id, fence, url));
    } catch (error) {
      await repository.releaseUploadSession(id, fence).catch(() => undefined);
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        "The upload could not start. Try again.",
      );
    }
  }
  const video = toVideoSnapshot(raw.video),
    upload = toUploadDescriptor(raw.upload, config.url);
  if (
    video.id !== id ||
    upload.assetId !== id ||
    video.byteSize !== upload.byteSize
  )
    invalidVideoData();
  return { video, upload };
}
export async function deleteVideo(
  rawId: string,
  input: unknown,
): Promise<VideoMutationResponse> {
  await requireCreator();
  await requireUploadsEnabled();
  const id = validation.parseVideoId(rawId),
    command = validation.parseVideoCommand(input),
    raw = videoRecord(await repository.beginDelete(id, command)),
    started = mutation(raw, id);
  if (started.video.state === "deleted") return started;
  const object = toVideoObject({ ...videoRecord(raw.object), assetId: id });
  const client = await createServerSupabaseClient();
  const { error } = await client.storage
    .from(object.bucket)
    .remove([object.objectPath]);
  if (error)
    throw new ApiError(
      "STORAGE_UNAVAILABLE",
      "Removal is pending. Retry to finish deleting this unused video.",
    );
  return mutation(await repository.finishDelete(id, command.requestId), id);
}
