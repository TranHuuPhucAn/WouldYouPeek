import type {
  CreateVideoRequest,
  PlaybackContext,
  VideoCommand,
} from "@/contracts/video";
import { ApiClientError, readApiResponse } from "./api-response";
import { invalidResponse, isRecord } from "./challenge-validation";
import { isUuid } from "./session-api";
import {
  parsePlaybackAccess,
  parseUploadSession,
  parseVideoAsset,
  parseVideoList,
  parseVideoMutation,
} from "./video-validation";

function path(id: string) {
  if (!isUuid(id))
    throw new ApiClientError(
      "INVALID_REQUEST",
      "This recording is unavailable.",
      400,
    );
  return `/api/creator/videos/${encodeURIComponent(id)}`;
}
async function request(url: string, signal?: AbortSignal, body?: unknown) {
  return readApiResponse(
    await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      signal,
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );
}
export async function listCreatorVideos(
  cursor: string | null = null,
  signal?: AbortSignal,
) {
  return parseVideoList(
    await request(
      `/api/creator/videos${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
      signal,
    ),
  );
}
export async function getCreatorVideo(id: string, signal?: AbortSignal) {
  return parseVideoAsset(await request(path(id), signal), id);
}
export async function findCreatorVideoByRequestId(
  id: string,
  signal?: AbortSignal,
) {
  if (!isUuid(id)) invalidResponse();
  const value = await request(
    `/api/creator/videos/requests/${encodeURIComponent(id)}`,
    signal,
  );
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !("video" in value)
  )
    invalidResponse();
  return value.video === null ? null : parseVideoAsset(value.video);
}
export async function createCreatorVideo(
  input: CreateVideoRequest,
  signal?: AbortSignal,
) {
  return parseVideoMutation(
    await request("/api/creator/videos", signal, input),
  );
}
export async function getUploadSession(id: string, signal?: AbortSignal) {
  return parseUploadSession(
    await request(`${path(id)}/upload-session`, signal, {}),
    id,
  );
}
export async function completeCreatorVideo(
  id: string,
  input: VideoCommand,
  signal?: AbortSignal,
) {
  return parseVideoMutation(
    await request(`${path(id)}/complete`, signal, input),
    id,
  );
}
export async function retryVideoValidation(
  id: string,
  input: VideoCommand,
  signal?: AbortSignal,
) {
  return parseVideoMutation(
    await request(`${path(id)}/retry-validation`, signal, input),
    id,
  );
}
export async function deleteCreatorVideo(
  id: string,
  input: VideoCommand,
  signal?: AbortSignal,
) {
  return parseVideoMutation(
    await request(`${path(id)}/delete`, signal, input),
    id,
  );
}
export async function getPlaybackAccess(
  context: PlaybackContext,
  assetId?: string,
  signal?: AbortSignal,
) {
  return parsePlaybackAccess(
    await request("/api/media/playback", signal, context),
    assetId,
  );
}
