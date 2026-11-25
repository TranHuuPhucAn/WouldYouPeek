import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { CreatorScenarioSnapshot } from "@/contracts/creator";
import type {
  VideoAssetSnapshot,
  VideoUploadDescriptor,
} from "@/contracts/video";
import {
  checklist,
  createVerifiedCreator,
  publishScenarioFixture,
  rpc,
} from "./helpers/creator-scenarios";
import {
  createLocalTestClient,
  getLocalTestConfig,
} from "./helpers/local-supabase";
import { moderationSql, sqlLiteral } from "./helpers/moderation";
import type { TestUser } from "./helpers/test-users";
import {
  fixture,
  initializeTus,
  objectPath,
  reserve,
  uploadedContent,
  uploadHeaders,
  uploadReady,
} from "./helpers/videos";

function mode(sourceMode: "youtube-only" | "youtube-and-upload") {
  moderationSql(
    `update private.deployment_settings set source_mode=${sqlLiteral(sourceMode)} where singleton;`,
  );
}

describe("hosted-mode admission through real RPC and Storage APIs", () => {
  let creator: TestUser;
  let ready: VideoAssetSnapshot;
  let pending: VideoAssetSnapshot;
  let upload: VideoUploadDescriptor;
  let scenario: CreatorScenarioSnapshot;
  const pendingBytes = Buffer.alloc(32, 7);

  beforeAll(async () => {
    creator = await createVerifiedCreator();
    ready = await uploadReady(creator, await fixture());
    scenario = await publishScenarioFixture(creator, uploadedContent(ready.id));
    pending = (await reserve(creator, pendingBytes)).video;
    upload = await initializeTus(creator, pending.id);
  });

  it("denies old reservations, direct byte writes/reads and TUS finalization without changing media state", async () => {
    const config = getLocalTestConfig();
    const headers = await uploadHeaders(creator);
    const before = moderationSql(
      `select jsonb_agg(to_jsonb(a) order by id) from private.video_assets a where id in (${sqlLiteral(ready.id)},${sqlLiteral(pending.id)});`,
    );
    mode("youtube-only");
    try {
      expect(
        await rpc(createLocalTestClient(), "get_application_capabilities"),
      ).toEqual({ sourceMode: "youtube-only" });
      const [
        reservation,
        initialization,
        completion,
        playback,
        directUpload,
        directRead,
        tus,
      ] = await Promise.all([
        creator.client.rpc("create_creator_video", {
          p_request_id: randomUUID(),
          p_file_name: "forged.mp4",
          p_byte_size: 32,
          p_mime_type: "video/mp4",
          p_content_fingerprint: "b".repeat(64),
        }),
        creator.client.rpc("get_creator_video_upload_session", {
          p_asset_id: pending.id,
        }),
        creator.client.rpc("complete_creator_video_upload", {
          p_asset_id: pending.id,
          p_request_id: randomUUID(),
          p_expected_revision: 0,
        }),
        creator.client.rpc("authorize_video_playback", {
          p_context: { kind: "creator-asset", assetId: ready.id },
        }),
        creator.client.storage
          .from("creator-vods")
          .upload(objectPath(creator, pending.id), pendingBytes, {
            contentType: "video/mp4",
            upsert: false,
          }),
        creator.client.storage
          .from("creator-vods")
          .download(objectPath(creator, ready.id)),
        fetch(upload.uploadUrl, {
          method: "PATCH",
          headers: {
            ...headers,
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
          },
          body: new Uint8Array(pendingBytes),
        }),
      ]);
      for (const response of [
        reservation,
        initialization,
        completion,
        playback,
      ])
        expect(response.error?.message).toBe("UPLOADS_DISABLED");
      expect(directUpload.error).not.toBeNull();
      expect(directRead.error).not.toBeNull();
      expect(tus.ok).toBe(false);
      expect(
        moderationSql(
          `select count(*) from storage.objects where bucket_id='creator-vods' and name=${sqlLiteral(objectPath(creator, pending.id))};`,
        ),
      ).toBe("0");
      expect(
        moderationSql(
          `select jsonb_agg(to_jsonb(a) order by id) from private.video_assets a where id in (${sqlLiteral(ready.id)},${sqlLiteral(pending.id)});`,
        ),
      ).toBe(before);
      // Even direct TUS creation, without an app-generated session descriptor,
      // cannot make an uploaded object admissible.
      const metadata = Object.entries({
        bucketName: "creator-vods",
        objectName: objectPath(creator, pending.id),
        contentType: "video/mp4",
      })
        .map(
          ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
        )
        .join(",");
      const created = await fetch(`${config.url}/storage/v1/upload/resumable`, {
        method: "POST",
        headers: {
          ...headers,
          "Upload-Length": "32",
          "Upload-Metadata": metadata,
          "x-upsert": "false",
        },
      });
      if (created.status === 201) {
        // Some Storage versions defer RLS to finalization; creation alone must
        // never be misreported as permission to persist the recording.
        const location = new URL(created.headers.get("location")!, config.url);
        expect(location.origin).toBe(new URL(config.url).origin);
        const final = await fetch(location, {
          method: "PATCH",
          headers: {
            ...headers,
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
          },
          body: new Uint8Array(pendingBytes),
        });
        expect(final.ok).toBe(false);
      } else expect(created.ok).toBe(false);
    } finally {
      mode("youtube-and-upload");
    }
  });

  it("keeps uploaded draft text readable but denies saving, reviewing and publishing the disabled source", async () => {
    mode("youtube-only");
    try {
      const current = await rpc<CreatorScenarioSnapshot>(
        creator.client,
        "get_creator_scenario",
        { p_scenario_id: scenario.id },
      );
      expect(current.draft.content).toEqual(scenario.draft.content);
      const results = await Promise.all([
        creator.client.rpc("save_creator_scenario", {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
          p_content: uploadedContent(ready.id),
        }),
        creator.client.rpc("review_creator_scenario", {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
          p_checklist: checklist(),
        }),
        creator.client.rpc("publish_creator_scenario", {
          p_scenario_id: scenario.id,
          p_request_id: randomUUID(),
          p_expected_revision: scenario.revision,
          p_review_id: scenario.review!.id,
        }),
        creator.client.rpc("get_creator_review_preview", {
          p_scenario_id: scenario.id,
          p_revision: scenario.revision,
        }),
      ]);
      for (const result of results)
        expect(result.error?.message).toBe("UPLOADS_DISABLED");
      expect(
        await rpc(creator.client, "get_creator_scenario", {
          p_scenario_id: scenario.id,
        }),
      ).toEqual(current);
    } finally {
      mode("youtube-and-upload");
    }
  });

  it("still permits YouTube authoring, review and publication while uploads are disabled", async () => {
    mode("youtube-only");
    try {
      const published = await publishScenarioFixture(creator);
      expect(published.publication.state).toBe("published");
      expect(
        await rpc(creator.client, "get_library_preview", {
          p_scenario_id: published.id,
        }),
      ).toMatchObject({ id: published.id });
    } finally {
      mode("youtube-and-upload");
    }
  });

  it("restoring the local profile retains original metadata and actual recording bytes", async () => {
    expect(
      await rpc(createLocalTestClient(), "get_application_capabilities"),
    ).toEqual({ sourceMode: "youtube-and-upload" });
    expect(
      await rpc(creator.client, "get_creator_video", { p_asset_id: ready.id }),
      // Publication references were added after uploadReady returned its DTO.
      // All persisted metadata stays identical; referenced media must stay undeletable.
    ).toEqual({ ...ready, canDelete: false });
    const result = await creator.client.storage
      .from("creator-vods")
      .download(objectPath(creator, ready.id));
    expect(result.error).toBeNull();
    expect(Buffer.from(await result.data!.arrayBuffer())).toEqual(
      await fixture(),
    );
  });
});
