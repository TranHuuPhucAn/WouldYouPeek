import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDisposableTarget } from "../../scripts/local-target.mjs";
import { applyPendingMigrations } from "../../scripts/local-test-stack.mjs";
import { snapshotM6Records } from "./milestone-7-preservation.test.mjs";
import { LAST_MODERATION_MIGRATION } from "./moderation-preservation.test.mjs";
import {
  upgradeSql,
  assertMigrationBoundary,
  createUpgradeUser,
  upgradeRpc,
  answerUpgradeSession,
  captureReadyMedia,
} from "./session-end-preservation.test.mjs";

export const LAST_MILESTONE10_MIGRATION = "20261123000100";

export async function runMilestone10Preservation(env = process.env) {
  const target = assertDisposableTarget(env);
  assertMigrationBoundary(target, LAST_MODERATION_MIGRATION);
  const learner = await createUpgradeUser(env);
  const creator = await createUpgradeUser(env);
  await upgradeRpc(creator, "enable_creator");
  const started = (
    await upgradeRpc(learner, "start_training_session", {
      p_request_id: randomUUID(),
    })
  ).session;
  const answered = await answerUpgradeSession(learner, started);
  const ended = (
    await upgradeRpc(learner, "end_training_session", {
      p_session_id: started.id,
      p_request_id: randomUUID(),
      p_expected_revision: answered.session.revision,
    })
  ).session;
  const reservation = {
    p_request_id: randomUUID(),
    p_file_name: "preserved-reservation.mp4",
    p_byte_size: 32,
    p_mime_type: "video/mp4",
    p_content_fingerprint: "a".repeat(64),
  };
  const reserved = await upgradeRpc(
    creator,
    "create_creator_video",
    reservation,
  );
  const before = snapshotM6Records(target);
  const bytes = await captureReadyMedia(target, env);
  await applyPendingMigrations(target, { through: LAST_MILESTONE10_MIGRATION });
  assertMigrationBoundary(target, LAST_MILESTONE10_MIGRATION);
  assert.deepEqual(
    snapshotM6Records(target, before),
    before,
    "M10 preserves every previous account/role, draft, publication, history, report, hold, receipt and media record",
  );
  assert.deepEqual(
    await captureReadyMedia(target, env),
    bytes,
    "M10 does not delete or rewrite existing video bytes",
  );
  assert.deepEqual(
    await upgradeRpc(learner, "get_application_capabilities"),
    { sourceMode: "youtube-only" },
    "An unconfigured new installation always denies uploads",
  );
  assert.deepEqual(
    await upgradeRpc(learner, "get_training_session", {
      p_session_id: ended.id,
    }),
    ended,
    "Ended history and its original answer snapshot remain readable",
  );
  assert.equal(
    (await creator.client.rpc("create_creator_video", reservation)).error
      ?.message,
    "UPLOADS_DISABLED",
    "Old idempotent reservation requests cannot evade disabled admission",
  );
  assert.equal(
    (
      await creator.client.rpc("get_creator_video_upload_session", {
        p_asset_id: reserved.video.id,
      })
    ).error?.message,
    "UPLOADS_DISABLED",
    "Pre-existing reservations cannot open resumable sessions",
  );
  const restarted = (
    await upgradeRpc(learner, "start_training_session", {
      p_request_id: randomUUID(),
    })
  ).session;
  assert.equal(
    restarted.phase,
    "setup",
    "YouTube sessions remain usable in hosted mode",
  );
  const nextAnswer = await answerUpgradeSession(learner, restarted);
  assert.equal(nextAnswer.session.phase, "review");
  // Restore the local profile only through the exact trusted maintenance artifact.
  upgradeSql(
    target,
    readFileSync(
      new URL(
        "../../supabase/maintenance/configure_local_capabilities.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(await upgradeRpc(creator, "get_application_capabilities"), {
    sourceMode: "youtube-and-upload",
  });
  const replay = await upgradeRpc(creator, "create_creator_video", reservation);
  assert.equal(replay.replayed, true);
  assert.deepEqual(
    replay.video,
    reserved.video,
    "Local restoration preserves the original reservation identity",
  );
  const initialized = await upgradeRpc(
    creator,
    "get_creator_video_upload_session",
    { p_asset_id: reserved.video.id },
  );
  assert.ok(
    initialized.initializationFence,
    "Local upload initialization works after the additive upgrade",
  );
  assert.deepEqual(
    await captureReadyMedia(target, env),
    bytes,
    "Original validated recordings still exist after local restoration",
  );
  console.log(
    "M10 upgrade preserved accounts, immutable history, moderation and recordings; disabled-mode admission and explicit local restoration passed.",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runMilestone10Preservation();
