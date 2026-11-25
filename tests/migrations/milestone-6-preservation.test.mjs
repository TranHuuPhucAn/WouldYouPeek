import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertDisposableTarget, cleanChildEnvironment } from "../../scripts/local-target.mjs";
import {
  applyPendingMigrations, assertDockerOwnership, LAST_M5_MIGRATION, LAST_M6_MIGRATION,
  runTestCommand, startTestMediaWorker, stopTestApp,
} from "../../scripts/local-test-stack.mjs";

const TENZ_PLAYER_ID = "76af0a04-4751-4d26-9233-183a252e124b";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const checklist = Object.fromEntries([
  "povInformationChecked", "setupSpoilersChecked", "pauseTimingChecked", "continuationChecked",
  "normalSpeedAudioChecked", "alternativeChoicesChecked", "sourceAttributionChecked",
].map((key) => [key, true]));

function sql(target, statement) {
  assertDockerOwnership(target);
  return execFileSync("docker", ["exec", "-i", `supabase_db_${target.projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", env: cleanChildEnvironment(), stdio: ["pipe", "pipe", "inherit"] }).trim();
}
function client(env, admin = false) {
  return createClient(env.SUPABASE_TEST_URL, admin ? env.SUPABASE_TEST_SERVICE_ROLE_KEY : env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function rpc(user, name, input = {}) {
  const result = await user.client.rpc(name, input);
  assert.equal(result.error?.message ?? null, null, `M6 upgrade RPC ${name} must succeed`);
  return result.data;
}
async function createUser(env, creator) {
  const email = `wyp-m6-upgrade-${randomUUID()}@example.test`, password = `LocalOnly-${randomUUID()}-A1`;
  const result = await client(env, true).auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(result.error?.message ?? null, null);
  const user = { id: result.data.user.id, email, password, client: client(env) };
  assert.equal((await user.client.auth.signInWithPassword({ email, password })).error?.message ?? null, null);
  if (creator) await rpc(user, "enable_creator");
  return user;
}
function content(title, player, assetId) {
  const draft = JSON.parse(readFileSync(new URL("../fixtures/creator-content-cases.json", import.meta.url), "utf8")).validContent;
  draft.title = title;
  draft.source.player = player;
  if (assetId) {
    const { url, ...attribution } = draft.source;
    draft.source = { ...attribution, kind: "uploaded", assetId, creditUrl: url };
    draft.media = { ...draft.media, startSeconds: 0, decisionSeconds: 7, endSeconds: 13 };
  }
  return draft;
}
async function saveReviewed(user, scenario, draft, publish = true) {
  scenario = (await rpc(user, "save_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(),
    p_expected_revision: scenario.revision, p_content: draft })).scenario;
  scenario = (await rpc(user, "review_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(),
    p_expected_revision: scenario.revision, p_checklist: checklist })).scenario;
  if (publish) scenario = (await rpc(user, "publish_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(),
    p_expected_revision: scenario.revision, p_review_id: scenario.review.id })).scenario;
  return scenario;
}
async function createScenario(user, draft, publish = true) {
  const created = (await rpc(user, "create_creator_scenario", { p_request_id: randomUUID() })).scenario;
  return saveReviewed(user, created, draft, publish);
}
async function start(user, scenarioId) {
  const requestId = randomUUID(), target = scenarioId ? { kind: "scenario", scenarioId } : { kind: "demo" };
  const method = scenarioId ? "start_selected_training_session" : "start_training_session";
  const input = { p_request_id: requestId, ...(scenarioId ? { p_target: target } : {}) };
  return { session: (await rpc(user, method, input)).session, requestId, target, method, input };
}
async function answer(user, session) {
  const item = session.items[session.currentIndex], requestId = randomUUID();
  const input = { p_session_id: session.id, p_item_id: item.id, p_option_id: item.challenge.options[0].id,
    p_request_id: requestId, p_expected_revision: session.revision };
  return { session: (await rpc(user, "submit_session_answer", input)).session, input };
}
async function advance(user, session) {
  return (await rpc(user, "advance_training_session", { p_session_id: session.id,
    p_from_item_id: session.items[session.currentIndex].id, p_request_id: randomUUID(), p_expected_revision: session.revision })).session;
}
async function finish(user, session) {
  while (session.phase !== "completed") session = session.phase === "setup" ? (await answer(user, session)).session : await advance(user, session);
  return session;
}

// Exercise the actual M5 reservation, TUS bytes and local validator before applying M6.
// A direct SQL insertion of a ready asset would miss storage/version preservation.
async function uploadReady(user, env, bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 ** 2)
    chunks.push(createHash("sha256").update(bytes.subarray(offset, offset + 4 * 1024 ** 2)).digest());
  const { video } = await rpc(user, "create_creator_video", { p_request_id: randomUUID(), p_file_name: "m6-upgrade.mp4",
    p_byte_size: bytes.length, p_mime_type: "video/mp4", p_content_fingerprint: sha256(Buffer.concat(chunks)) });
  const initialization = await rpc(user, "get_creator_video_upload_session", { p_asset_id: video.id });
  assert.ok(initialization.initializationFence);
  const { data: { session } } = await user.client.auth.getSession();
  const headers = { authorization: `Bearer ${session.access_token}`, apikey: env.SUPABASE_TEST_PUBLISHABLE_KEY, "Tus-Resumable": "1.0.0" };
  const metadata = Object.entries({ bucketName: "creator-vods", objectName: initialization.upload.objectPath,
    contentType: "video/mp4", cacheControl: "0" }).map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`).join(",");
  const created = await fetch(`${env.SUPABASE_TEST_URL}/storage/v1/upload/resumable`, { method: "POST",
    headers: { ...headers, "Upload-Length": String(bytes.length), "Upload-Metadata": metadata, "x-upsert": "false" } });
  assert.equal(created.status, 201, "M5 fixture TUS reservation succeeds");
  assert.ok(created.headers.get("location"));
  const uploadUrl = new URL(created.headers.get("location"), env.SUPABASE_TEST_URL);
  assert.equal(uploadUrl.origin, new URL(env.SUPABASE_TEST_URL).origin, "Test upload remains on the owned local storage service");
  await rpc(user, "finish_creator_video_upload_session", { p_asset_id: video.id, p_fence: initialization.initializationFence, p_upload_url: uploadUrl.toString() });
  for (let offset = 0; offset < bytes.length; offset += 6 * 1024 ** 2) {
    const end = Math.min(bytes.length, offset + 6 * 1024 ** 2);
    const patched = await fetch(uploadUrl, { method: "PATCH", headers: { ...headers,
      "Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset) }, body: new Uint8Array(bytes.subarray(offset, end)) });
    assert.equal(patched.status, 204, "M5 fixture TUS bytes are accepted");
    assert.equal(Number(patched.headers.get("upload-offset")), end);
  }
  await rpc(user, "complete_creator_video_upload", { p_asset_id: video.id, p_request_id: randomUUID(), p_expected_revision: video.revision });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const checked = await rpc(user, "get_creator_video", { p_asset_id: video.id });
    assert.notEqual(checked.state, "rejected", `M5 fixture validator rejected the original test recording: ${checked.failure?.code ?? "unknown"}`);
    if (checked.state === "ready") return { video: checked, objectPath: initialization.upload.objectPath, sha256: sha256(bytes) };
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("M5 fixture did not become a validated ready upload before the migration");
}

function assertM5Boundary(target) {
  assert.equal(sql(target, "select version from supabase_migrations.schema_migrations order by version desc limit 1;"), LAST_M5_MIGRATION,
    "Library preservation starts on the real M5 schema, with M6 still staged");
}

export async function createM5Baseline(target, env) {
  assertM5Boundary(target);
  const creator = await createUser(env, true), second = await createUser(env, true);
  const demoLearner = await createUser(env, false), singleLearner = await createUser(env, false);
  const bytes = readFileSync(join(target.workspace, "test-results/generated-video/with-audio.mp4"));
  const upload = await uploadReady(creator, env, bytes);

  let live = await createScenario(creator, content("M6 upgrade: historical player attribution", "M6 Former Player"));
  live = await saveReviewed(creator, live, content("M6 upgrade: current TenZ attribution", "  TeNZ  "));
  const variant = await createScenario(second, content("M6 upgrade: lowercase attribution", "tenz"));
  const longName = `M6 ${"L".repeat(247)}`, expandingName = "\uFDFA".repeat(20);
  assert.equal([...longName].length, 250, "Legacy source names may occupy the full M5 field range");
  assert.ok([...expandingName].length <= 300 && [...expandingName.normalize("NFKC")].length > 300,
    "This valid M5 source name expands beyond the raw-field bound under NFKC");
  const legacyNames = [
    { owner: creator, sourcePlayer: longName,
      scenario: await createScenario(creator, content("M6 upgrade: valid long legacy attribution", longName)) },
    { owner: second, sourcePlayer: expandingName,
      scenario: await createScenario(second, content("M6 upgrade: expanding legacy attribution", expandingName)) },
  ];
  const reviewed = await createScenario(second, content("M6 upgrade: reviewed unpublished draft", "M6 Draft Only Player"), false);
  let withdrawn = await createScenario(creator, content("M6 upgrade: old uploaded version", "M6   Media Player", upload.video.id));
  const activeSingle = await start(singleLearner, withdrawn.id);
  withdrawn = await saveReviewed(creator, withdrawn, content("M6 upgrade: replacement uploaded version", "M6 Media Player", upload.video.id));
  withdrawn = (await rpc(creator, "unpublish_creator_scenario", { p_scenario_id: withdrawn.id,
    p_request_id: randomUUID(), p_expected_revision: withdrawn.revision })).scenario;
  const uploadedLive = await createScenario(creator, content("M6 upgrade: visible uploaded scenario", "m6 media player", upload.video.id));

  const completedDemo = await start(creator);
  completedDemo.session = await finish(creator, completedDemo.session);
  const completedSingle = await start(creator, live.id);
  completedSingle.session = await finish(creator, completedSingle.session);
  const activeDemo = await start(demoLearner);
  const oldAnswer = await answer(demoLearner, activeDemo.session);
  activeDemo.session = await advance(demoLearner, oldAnswer.session);
  assert.equal(activeDemo.session.currentIndex, 1);
  assert.equal(activeDemo.session.phase, "setup");
  assert.equal(activeSingle.session.phase, "setup");
  assert.equal(withdrawn.publication.state, "withdrawn");
  const seeds = JSON.parse(sql(target, "select jsonb_agg(id order by sort_order,id) from public.scenarios where is_demo;"));
  assert.equal(seeds.length, 3, "All three original curated IDs are present before upgrading");
  return { creator, second, demoLearner, singleLearner, live, variant, reviewed, withdrawn, uploadedLive, upload,
    completedDemo, completedSingle, activeDemo, activeSingle, oldAnswer, seeds, legacyNames };
}

export function snapshotM5Records(target) {
  const tables = ["auth.users", "auth.identities", "public.profiles", "public.scenarios", "public.scenario_versions",
    "private.scenario_answer_keys", "private.scenario_drafts", "private.scenario_reviews", "private.creator_commands",
    "public.training_sessions", "public.training_session_items", "public.attempts", "private.session_commands",
    "private.video_assets", "private.video_asset_commands", "private.scenario_draft_assets", "private.scenario_version_assets", "storage.objects"];
  return Object.fromEntries(tables.map((table) => {
    const serialized = sql(target, `select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb) from (select to_jsonb(t) as value from ${table} t) records;`);
    // Comparing full-row digests avoids printing password hashes or fixture contents on a failed assertion.
    return [table, { count: JSON.parse(serialized).length, sha256: sha256(serialized) }];
  }));
}

function assertSafePreview(preview) {
  const forbidden = new Set(["question", "options", "answerKey", "observedAction", "analysis", "outcomeText", "takeaway",
    "decision", "reveal", "revealMedia", "draft", "email", "signedUrl", "objectPath", "bucket"]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) { assert.equal(forbidden.has(key), false, `Guest preview must not expose ${key}`); visit(nested); }
  };
  visit(preview);
}

function assertPlayerIdentityParity(target) {
  const fixtures = JSON.parse(readFileSync(new URL("../fixtures/player-identity.json", import.meta.url), "utf8"));
  const literal = `'${JSON.stringify(fixtures).replaceAll("'", "''")}'::jsonb`;
  const actual = JSON.parse(sql(target, `select jsonb_agg(jsonb_build_object(
    'input', fixture->>'input',
    'displayName', private.normalize_player_display_name(fixture->>'input'),
    'key', private.normalize_player_key(fixture->>'input')) order by ordinal)
    from jsonb_array_elements(${literal}) with ordinality as cases(fixture, ordinal);`));
  assert.deepEqual(actual, fixtures,
    "Real PostgreSQL normalization must match the same Unicode fixtures used by the JavaScript identity tests");
}

export async function assertM5Preserved(target, before, baseline, env) {
  assert.deepEqual(snapshotM5Records(target), before,
    "M6 must leave every old account, source, immutable content, review digest, upload reference, checkpoint, answer and command receipt byte-for-byte unchanged");
  assertPlayerIdentityParity(target);
  assert.equal(Number(sql(target, "select count(*) from public.scenario_versions v left join private.scenario_version_players m on m.scenario_version_id=v.id where m.scenario_version_id is null;")), 0,
    "Backfill maps current, historical and withdrawn versions without rewriting them");
  assert.equal(Number(sql(target, "select count(*) from public.players where normalized_key='tenz';")), 1, "Case and whitespace variants share one canonical TenZ identity");

  for (const user of [baseline.creator, baseline.second, baseline.demoLearner, baseline.singleLearner]) {
    user.client = client(env);
    assert.equal((await user.client.auth.signInWithPassword({ email: user.email, password: user.password })).error?.message ?? null, null, "Existing passwords remain usable");
  }
  for (const [user, original] of [[baseline.creator, baseline.live], [baseline.second, baseline.variant],
    [baseline.second, baseline.reviewed], [baseline.creator, baseline.withdrawn], [baseline.creator, baseline.uploadedLive],
    ...baseline.legacyNames.map(({ owner, scenario }) => [owner, scenario])])
    assert.deepEqual(await rpc(user, "get_creator_scenario", { p_scenario_id: original.id }), original, "M5 authoring, review and publication snapshots survive unchanged");

  for (const [user, entry] of [[baseline.creator, baseline.completedDemo], [baseline.creator, baseline.completedSingle],
    [baseline.demoLearner, baseline.activeDemo], [baseline.singleLearner, baseline.activeSingle]]) {
    assert.deepEqual(await rpc(user, "get_training_session", { p_session_id: entry.session.id }), entry.session, "Legacy saved session is identical");
    const replay = await rpc(user, entry.method, entry.input);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.session, entry.session, "Legacy start receipts still address their original session");
  }
  const replayedAnswer = await rpc(baseline.demoLearner, "submit_session_answer", baseline.oldAnswer.input);
  assert.equal(replayedAnswer.replayed, true, "A pre-M6 answer command remains idempotent");
  assert.deepEqual(replayedAnswer.session.items[0].answer, baseline.oldAnswer.session.items[0].answer);
  assert.equal((await rpc(baseline.demoLearner, "get_active_training_session")).id, baseline.activeDemo.session.id);
  assert.equal((await rpc(baseline.singleLearner, "get_active_training_session")).id, baseline.activeSingle.session.id);
  assert.equal(await rpc(baseline.creator, "get_active_training_session"), null, "Completed history is not mistaken for an active session");
  assert.ok((await baseline.second.client.rpc("get_training_session", { p_session_id: baseline.activeSingle.session.id })).error, "Other learners cannot resume someone else's session");

  const guest = { client: client(env) };
  for (const { sourcePlayer, scenario } of baseline.legacyNames) {
    const preview = await rpc(guest, "get_library_preview", { p_scenario_id: scenario.id });
    assert.equal(preview.source.player, sourcePlayer, "M6 must not rewrite valid legacy source attribution");
    assert.equal(preview.player.displayName, sourcePlayer.normalize("NFKC"),
      "Long and NFKC-expanding M5 names remain visible through their canonical mapping");
    assertSafePreview(preview);
  }
  const tenz = await rpc(guest, "get_library_player", { p_player_id: TENZ_PLAYER_ID });
  assert.equal(tenz.displayName, "TenZ");
  const listed = await rpc(guest, "list_library_previews", { p_player_id: TENZ_PLAYER_ID, p_limit: 50 });
  for (const id of [...baseline.seeds, baseline.live.id, baseline.variant.id]) assert.ok(listed.scenarios.some((item) => item.id === id));
  for (const id of baseline.seeds) {
    const preview = await rpc(guest, "get_library_preview", { p_scenario_id: id });
    assert.equal(preview.player.id, TENZ_PLAYER_ID);
    assert.equal(preview.editorialOrigin, "curated");
    assert.equal(preview.provenance, "ai");
    assert.equal(preview.publishedAt, null, "An old demo does not gain an invented publication timestamp");
    assertSafePreview(preview);
  }
  const mediaGroups = await rpc(guest, "list_library_players", { p_query: "m6 media" });
  assert.equal(mediaGroups.players.length, 1);
  assert.equal(mediaGroups.players[0].scenarioCount, 1, "Withdrawn and historical versions do not inflate public counts");
  assert.equal(mediaGroups.players[0].scenarios[0].id, baseline.uploadedLive.id);
  assertSafePreview(mediaGroups.players[0].scenarios[0]);
  for (const query of ["m6 former player", "m6 draft only player"])
    assert.equal((await rpc(guest, "list_library_players", { p_query: query })).players.length, 0, "Private drafts and historical-only identities stay out of public browsing");
  for (const id of [baseline.withdrawn.id, baseline.reviewed.id])
    assert.ok((await guest.client.rpc("get_library_preview", { p_scenario_id: id })).error, "Unpublished content stays private");
  assert.ok((await guest.client.rpc("get_active_training_session")).error, "Guest catalogue permission does not grant session access");
  assert.ok((await guest.client.rpc("authorize_video_playback", { p_context: { kind: "library-scenario", scenarioId: baseline.uploadedLive.id } })).error,
    "Public uploaded metadata does not grant anonymous video access");
  assert.ok((await guest.client.rpc("start_selected_training_session", { p_request_id: randomUUID(), p_target: { kind: "scenario", scenarioId: baseline.seeds[0] } })).error,
    "Guest catalogue permission does not grant gameplay");

  const access = { kind: "session-item", sessionId: baseline.activeSingle.session.id,
    itemId: baseline.activeSingle.session.items[0].id, phase: "setup" };
  assert.equal((await rpc(baseline.singleLearner, "authorize_video_playback", { p_context: access })).assetId, baseline.upload.video.id,
    "The pinned old upload remains authorized after version replacement and withdrawal");
  assert.ok((await baseline.singleLearner.client.rpc("authorize_video_playback", { p_context: { ...access, phase: "reveal" } })).error,
    "Migration must not unlock continuation before an answer");
  const downloaded = await client(env, true).storage.from("creator-vods").download(baseline.upload.objectPath);
  assert.equal(downloaded.error?.message ?? null, null);
  assert.equal(sha256(Buffer.from(await downloaded.data.arrayBuffer())), baseline.upload.sha256, "Original uploaded video bytes survive");
  assert.equal((await rpc(baseline.creator, "get_creator_video", { p_asset_id: baseline.upload.video.id })).state, "ready");
  const answered = (await answer(baseline.singleLearner, baseline.activeSingle.session)).session;
  assert.equal((await rpc(baseline.singleLearner, "authorize_video_playback", { p_context: { ...access, phase: "reveal" } })).assetId, baseline.upload.video.id);
  assert.equal((await finish(baseline.singleLearner, answered)).phase, "completed", "Old withdrawn single-scenario sessions can finish");
  assert.equal((await finish(baseline.demoLearner, baseline.activeDemo.session)).phase, "completed", "Old three-scenario sessions can finish");
  assert.ok((await baseline.singleLearner.client.rpc("start_selected_training_session", { p_request_id: randomUUID(),
    p_target: { kind: "scenario", scenarioId: baseline.withdrawn.id } })).error, "Withdrawal still prevents new sessions");
  for (const id of baseline.seeds) {
    const single = await start(baseline.creator, id);
    assert.equal(single.session.items.length, 1, "Each preserved curated slug starts individually");
    assert.deepEqual(single.session.target, { kind: "scenario", scenarioId: id });
    await finish(baseline.creator, single.session);
  }
}

export async function runLibraryMigrationPreservation(env = process.env) {
  const target = assertDisposableTarget(env);
  assertM5Boundary(target);
  // No worker may mutate upload state while immutable M5 row digests are compared.
  let worker, baseline;
  try {
    await runTestCommand(process.execPath, ["scripts/generate-video-fixtures.mjs"], { cwd: target.workspace, env });
    worker = await startTestMediaWorker(target, env);
    baseline = await createM5Baseline(target, env);
  } finally {
    if (worker) await stopTestApp(worker);
  }
  const before = snapshotM5Records(target);
  await applyPendingMigrations(target, { through: LAST_M6_MIGRATION });
  await assertM5Preserved(target, before, baseline, env);
  console.log("Library upgrade preservation passed: accounts, full immutable rows, reviews, real upload bytes/references, legacy demo/single sessions, answers and receipts survived; guest catalogue and individual curated starts work.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runLibraryMigrationPreservation();
}
