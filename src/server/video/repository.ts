import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { databaseError } from "@/server/http";
import type {
  CreateVideoRequest,
  VideoCommand,
  PlaybackContext,
} from "@/contracts/video";
import type { Database, Json } from "@/types/database";

type RpcName = keyof Database["public"]["Functions"];
async function rpc(
  name: RpcName,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc(name, args as never);
  if (error) databaseError(error);
  return data;
}
export function createVideo(c: CreateVideoRequest) {
  return rpc("create_creator_video", {
    p_request_id: c.requestId,
    p_file_name: c.fileName,
    p_byte_size: c.byteSize,
    p_mime_type: c.mimeType,
    p_content_fingerprint: c.contentFingerprint,
  });
}
export function listVideos(cursor: string | null) {
  return rpc("list_creator_videos", { p_cursor: cursor, p_limit: 20 });
}
export function getVideo(id: string) {
  return rpc("get_creator_video", { p_asset_id: id });
}
export function findVideoRequest(requestId: string) {
  return rpc("get_creator_video_request", { p_request_id: requestId });
}
export function getUploadSession(id: string) {
  return rpc("get_creator_video_upload_session", { p_asset_id: id });
}
export function finishUploadSession(id: string, fence: string, url: string) {
  return rpc("finish_creator_video_upload_session", {
    p_asset_id: id,
    p_fence: fence,
    p_upload_url: url,
  });
}
export function releaseUploadSession(id: string, fence: string) {
  return rpc("release_creator_video_upload_session", {
    p_asset_id: id,
    p_fence: fence,
  });
}
export function completeUpload(id: string, c: VideoCommand) {
  return rpc("complete_creator_video_upload", {
    p_asset_id: id,
    p_request_id: c.requestId,
    p_expected_revision: c.expectedRevision,
  });
}
export function retryValidation(id: string, c: VideoCommand) {
  return rpc("retry_creator_video_validation", {
    p_asset_id: id,
    p_request_id: c.requestId,
    p_expected_revision: c.expectedRevision,
  });
}
export function beginDelete(id: string, c: VideoCommand) {
  return rpc("begin_creator_video_delete", {
    p_asset_id: id,
    p_request_id: c.requestId,
    p_expected_revision: c.expectedRevision,
  });
}
export function finishDelete(id: string, requestId: string) {
  return rpc("finish_creator_video_delete", {
    p_asset_id: id,
    p_request_id: requestId,
  });
}
export function authorizePlayback(context: PlaybackContext) {
  return rpc("authorize_video_playback", {
    p_context: context as unknown as Json,
  });
}
