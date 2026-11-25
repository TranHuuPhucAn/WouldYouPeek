import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestUser } from "./helpers/test-users";
import { cleanupTestUsers } from "./helpers/test-users";
import {
  createLocalTestClient,
  getLocalTestConfig,
} from "./helpers/local-supabase";
import { createVerifiedCreator, rpc } from "./helpers/creator-scenarios";
import {
  fixture,
  finishUpload,
  initializeTus,
  objectPath,
  patchTus,
  reserve,
  uploadHeaders,
  uploadReady,
  waitVideo,
} from "./helpers/videos";
import type {
  VideoAssetSnapshot,
  VideoMutationResponse,
} from "@/contracts/video";
import { VIDEO_CHUNK_BYTES } from "@/lib/video/upload-policy";
let owner: TestUser, other: TestUser;
const paths: string[] = [];
beforeAll(async () => {
  owner = await createVerifiedCreator();
  other = await createVerifiedCreator();
});
afterAll(async () => {
  if (paths.length)
    await createLocalTestClient("admin")
      .storage.from("creator-vods")
      .remove(paths);
  await cleanupTestUsers([owner, other].filter(Boolean));
});
describe("real private Storage with resumable uploads", () => {
  it("resumes an interrupted multi-chunk TUS transfer and validates trusted codec metadata", async () => {
    const bytes = await fixture("resumable.mp4");
    expect(bytes.length).toBeGreaterThan(VIDEO_CHUNK_BYTES);
    const { video } = await reserve(owner, bytes),
      upload = await initializeTus(owner, video.id);
    paths.push(upload.objectPath);
    await patchTus(owner, upload.uploadUrl, bytes, 0, VIDEO_CHUNK_BYTES);
    const recovered = await initializeTus(owner, video.id);
    expect(recovered.uploadUrl).toBe(upload.uploadUrl);
    const head = await fetch(recovered.uploadUrl, {
      method: "HEAD",
      headers: await uploadHeaders(owner),
    });
    expect(head.status).toBe(200);
    expect(Number(head.headers.get("upload-offset"))).toBe(VIDEO_CHUNK_BYTES);
    for (
      let offset = VIDEO_CHUNK_BYTES;
      offset < bytes.length;
      offset += VIDEO_CHUNK_BYTES
    )
      await patchTus(
        owner,
        recovered.uploadUrl,
        bytes,
        offset,
        Math.min(offset + VIDEO_CHUNK_BYTES, bytes.length),
      );
    const command = {
      p_asset_id: video.id,
      p_request_id: randomUUID(),
      p_expected_revision: video.revision,
    };
    await rpc(owner.client, "complete_creator_video_upload", command);
    expect(
      (
        await rpc<VideoMutationResponse>(
          owner.client,
          "complete_creator_video_upload",
          command,
        )
      ).replayed,
    ).toBe(true);
    const ready = await waitVideo(owner, video.id);
    expect(ready.metadata).toMatchObject({
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: null,
      width: 1280,
      height: 720,
    });
    expect(ready.actualByteSize).toBe(bytes.length);
    const expiring = await owner.client.storage
      .from("creator-vods")
      .createSignedUrl(upload.objectPath, 1);
    expect(expiring.error).toBeNull();
    expect((await fetch(expiring.data!.signedUrl, { method: "HEAD" })).ok).toBe(
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 2100));
    expect((await fetch(expiring.data!.signedUrl)).ok).toBe(false);
    expect(
      (await other.client.rpc("get_creator_video", { p_asset_id: video.id }))
        .error?.message,
    ).toBe("VIDEO_NOT_FOUND");
    expect(
      (
        await other.client.storage
          .from("creator-vods")
          .download(upload.objectPath)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await createLocalTestClient()
          .storage.from("creator-vods")
          .download(upload.objectPath)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await owner.client.storage
          .from("creator-vods")
          .upload(upload.objectPath, new Uint8Array(bytes), {
            contentType: "video/mp4",
            upsert: true,
          })
      ).error,
    ).not.toBeNull();
    expect(
      (await owner.client.rpc("claim_video_validation")).error,
    ).not.toBeNull();
  });
  it("accepts supported AAC and rejects corrupt actual bytes despite the MP4 extension", async () => {
    const audio = await uploadReady(owner, await fixture());
    paths.push(objectPath(owner, audio.id));
    expect(audio.metadata?.audioCodec).toBe("aac");
    const bad = Buffer.from("not an MP4"),
      { video } = await reserve(owner, bad, "corrupt.mp4"),
      upload = await initializeTus(owner, video.id);
    paths.push(upload.objectPath);
    await patchTus(owner, upload.uploadUrl, bad);
    await finishUpload(owner, video);
    const rejected = await waitVideo(owner, video.id, "rejected");
    expect(rejected.metadata).toBeNull();
    expect(rejected.failure).not.toBeNull();
    expect(
      (
        await owner.client.rpc("authorize_video_playback", {
          p_context: { kind: "creator-asset", assetId: video.id },
        })
      ).error?.message,
    ).toBe("VIDEO_NOT_READY");
  });
  it("refuses arbitrary paths and actual-size mismatches, and releases deleted reservations idempotently", async () => {
    const bytes = await fixture("resumable.mp4"),
      { video } = await reserve(other, bytes);
    const arbitrary = await other.client.storage
      .from("creator-vods")
      .upload(`${other.id}/${randomUUID()}/source.mp4`, new Uint8Array(bytes), {
        contentType: "video/mp4",
      });
    expect(arbitrary.error).not.toBeNull();
    const wrongSize = await other.client.storage
      .from("creator-vods")
      .upload(
        objectPath(other, video.id),
        new Uint8Array(bytes.subarray(0, 10)),
        { contentType: "video/mp4" },
      );
    expect(wrongSize.error).not.toBeNull();
    const interrupted = await initializeTus(other, video.id);
    await patchTus(other, interrupted.uploadUrl, bytes, 0, VIDEO_CHUNK_BYTES);
    const command = {
      p_asset_id: video.id,
      p_request_id: randomUUID(),
      p_expected_revision: video.revision,
    };
    const deleting = await rpc<VideoMutationResponse>(
      other.client,
      "begin_creator_video_delete",
      command,
    );
    expect(deleting.video.state).toBe("deleting");
    await rpc(other.client, "finish_creator_video_delete", {
      p_asset_id: video.id,
      p_request_id: command.p_request_id,
    });
    const replay = await rpc<VideoMutationResponse>(
      other.client,
      "begin_creator_video_delete",
      command,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.video.state).toBe("deleted");
    const session = await other.client.rpc("get_creator_video_upload_session", {
      p_asset_id: video.id,
    });
    expect(session.error).not.toBeNull();
    let finalizedAfterDeletion = true;
    for (
      let offset = VIDEO_CHUNK_BYTES;
      offset < bytes.length;
      offset += VIDEO_CHUNK_BYTES
    ) {
      const response = await fetch(interrupted.uploadUrl, {
        method: "PATCH",
        headers: {
          ...(await uploadHeaders(other)),
          "Content-Type": "application/offset+octet-stream",
          "Upload-Offset": String(offset),
        },
        body: new Uint8Array(
          bytes.subarray(
            offset,
            Math.min(offset + VIDEO_CHUNK_BYTES, bytes.length),
          ),
        ),
      });
      if (!response.ok) {
        finalizedAfterDeletion = false;
        break;
      }
    }
    expect(finalizedAfterDeletion).toBe(false);
    expect(
      (
        await other.client.storage
          .from("creator-vods")
          .download(objectPath(other, video.id))
      ).error,
    ).not.toBeNull();
    const publicURL = `${getLocalTestConfig().url}/storage/v1/object/public/creator-vods/${objectPath(other, video.id)}`;
    expect((await fetch(publicURL)).ok).toBe(false);
  });
});
