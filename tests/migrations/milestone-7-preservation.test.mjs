import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertDisposableTarget, cleanChildEnvironment } from "../../scripts/local-target.mjs";
import {
  applyPendingMigrations, assertDockerOwnership, LAST_M6_MIGRATION,
  runTestCommand, startTestMediaWorker, stopTestApp,
} from "../../scripts/local-test-stack.mjs";

const LAST_PLAYLIST_MIGRATION = "20261121000400";
const TENZ_PLAYER_ID = "76af0a04-4751-4d26-9233-183a252e124b";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const checklist = Object.fromEntries([
  "povInformationChecked", "setupSpoilersChecked", "pauseTimingChecked", "continuationChecked",
  "normalSpeedAudioChecked", "alternativeChoicesChecked", "sourceAttributionChecked",
].map((key) => [key, true]));

function sql(target, statement) {
  assertDockerOwnership(target);
  return execFileSync("docker", ["exec", "-i", `supabase_db_${target.projectId}`, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", env: cleanChildEnvironment(), stdio: ["pipe", "pipe", "inherit"], maxBuffer: 16 * 1024 ** 2 }).trim();
}
function client(env, admin = false) {
  return createClient(env.SUPABASE_TEST_URL, admin ? env.SUPABASE_TEST_SERVICE_ROLE_KEY : env.SUPABASE_TEST_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function rpc(user, name, input = {}) {
  const result = await user.client.rpc(name, input);
  assert.equal(result.error?.message ?? null, null, `M7 upgrade RPC ${name} must succeed`);
  return result.data;
}
async function createUser(env, creator) {
  const email = `wyp-m7-upgrade-${randomUUID()}@example.test`, password = `LocalOnly-${randomUUID()}-A1`;
  const result = await client(env, true).auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(result.error?.message ?? null, null);
  const user = { id: result.data.user.id, email, password, client: client(env), creatorCommands: [] };
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
async function creatorCommand(user, method, input) {
  const result = await rpc(user, method, input);
  user.creatorCommands.push({ method, input, scenarioId: result.scenario.id, publishedVersion: result.publishedVersion });
  return result.scenario;
}
async function saveReviewed(user, scenario, draft, publish = true) {
  scenario = await creatorCommand(user, "save_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(),
    p_expected_revision: scenario.revision, p_content: draft });
  scenario = await creatorCommand(user, "review_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(),
    p_expected_revision: scenario.revision, p_checklist: checklist });
  if (publish) scenario = await creatorCommand(user, "publish_creator_scenario", { p_scenario_id: scenario.id, p_request_id: randomUUID(),
    p_expected_revision: scenario.revision, p_review_id: scenario.review.id });
  return scenario;
}
async function createScenario(user, draft, publish = true) {
  const created = await creatorCommand(user, "create_creator_scenario", { p_request_id: randomUUID() });
  return saveReviewed(user, created, draft, publish);
}
async function start(user, scenarioId) {
  const method = scenarioId ? "start_selected_training_session" : "start_training_session";
  const input = { p_request_id: randomUUID(), ...(scenarioId ? { p_target: { kind: "scenario", scenarioId } } : {}) };
  return { session: (await rpc(user, method, input)).session, method, input };
}
async function answer(user, session) {
  const item = session.items[session.currentIndex];
  const input = { p_session_id: session.id, p_item_id: item.id, p_option_id: item.challenge.options[0].id,
    p_request_id: randomUUID(), p_expected_revision: session.revision };
  return { session: (await rpc(user, "submit_session_answer", input)).session, input };
}
async function advance(user, session) {
  const input = { p_session_id: session.id, p_from_item_id: session.items[session.currentIndex].id,
    p_request_id: randomUUID(), p_expected_revision: session.revision };
  return { session: (await rpc(user, "advance_training_session", input)).session, input };
}
async function finish(user, session) {
  while (session.phase !== "completed") session = session.phase === "setup"
    ? (await answer(user, session)).session : (await advance(user, session)).session;
  return session;
}

// Use the actual reservation, resumable upload and validator, rather than SQL-ready fixtures.
async function uploadReady(user, env, bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 ** 2)
    chunks.push(createHash("sha256").update(bytes.subarray(offset, offset + 4 * 1024 ** 2)).digest());
  const reservation = { p_request_id: randomUUID(), p_file_name: "m7-upgrade.mp4",
    p_byte_size: bytes.length, p_mime_type: "video/mp4", p_content_fingerprint: sha256(Buffer.concat(chunks)) };
  const { video } = await rpc(user, "create_creator_video", reservation);
  const initialization = await rpc(user, "get_creator_video_upload_session", { p_asset_id: video.id });
  assert.ok(initialization.initializationFence);
  const { data: { session } } = await user.client.auth.getSession();
  const headers = { authorization: `Bearer ${session.access_token}`, apikey: env.SUPABASE_TEST_PUBLISHABLE_KEY, "Tus-Resumable": "1.0.0" };
  const metadata = Object.entries({ bucketName: "creator-vods", objectName: initialization.upload.objectPath,
    contentType: "video/mp4", cacheControl: "0" }).map(([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`).join(",");
  const created = await fetch(`${env.SUPABASE_TEST_URL}/storage/v1/upload/resumable`, { method: "POST",
    headers: { ...headers, "Upload-Length": String(bytes.length), "Upload-Metadata": metadata, "x-upsert": "false" } });
  assert.equal(created.status, 201, "M6 fixture TUS reservation succeeds");
  assert.ok(created.headers.get("location"));
  const uploadUrl = new URL(created.headers.get("location"), env.SUPABASE_TEST_URL);
  assert.equal(uploadUrl.origin, new URL(env.SUPABASE_TEST_URL).origin, "Fixture upload stays in its owned local stack");
  await rpc(user, "finish_creator_video_upload_session", { p_asset_id: video.id, p_fence: initialization.initializationFence, p_upload_url: uploadUrl.toString() });
  for (let offset = 0; offset < bytes.length; offset += 6 * 1024 ** 2) {
    const end = Math.min(bytes.length, offset + 6 * 1024 ** 2);
    const patched = await fetch(uploadUrl, { method: "PATCH", headers: { ...headers,
      "Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset) }, body: new Uint8Array(bytes.subarray(offset, end)) });
    assert.equal(patched.status, 204, "M6 fixture TUS bytes are accepted");
    assert.equal(Number(patched.headers.get("upload-offset")), end);
  }
  const completion = { p_asset_id: video.id, p_request_id: randomUUID(), p_expected_revision: video.revision };
  await rpc(user, "complete_creator_video_upload", completion);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const checked = await rpc(user, "get_creator_video", { p_asset_id: video.id });
    assert.notEqual(checked.state, "rejected", `M6 fixture validation rejected the test recording: ${checked.failure?.code ?? "unknown"}`);
    if (checked.state === "ready") return { video: checked, reservation, completion,
      objectPath: initialization.upload.objectPath, sha256: sha256(bytes) };
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("M6 fixture did not become a validated upload before the migration");
}

function assertM6Boundary(target) {
  assert.equal(sql(target, "select version from supabase_migrations.schema_migrations order by version desc limit 1;"), LAST_M6_MIGRATION,
    "Playlist preservation must begin at the actual M6 boundary, before any playlist migration");
  assert.equal(sql(target, "select to_regclass('public.playlists') is null;"), "t");
}

export async function createM6Baseline(target, env) {
  assertM6Boundary(target);
  const creator = await createUser(env, true), second = await createUser(env, true);
  const demoLearner = await createUser(env, false), singleLearner = await createUser(env, false);
  const bytes = readFileSync(join(target.workspace, "test-results/generated-video/with-audio.mp4"));
  const upload = await uploadReady(creator, env, bytes);
  let live = await createScenario(creator, content("M7 upgrade: historical player", "M7 Former Player"));
  live = await saveReviewed(creator, live, content("M7 upgrade: current TenZ scenario", "  TeNZ  "));
  const variant = await createScenario(second, content("M7 upgrade: canonical case variant", "tenz"));
  const longName = `M7 ${"L".repeat(247)}`, expandingName = "\uFDFA".repeat(20);
  const legacyNames = [
    { owner: creator, sourcePlayer: longName, scenario: await createScenario(creator, content("M7 upgrade: long player name", longName)) },
    { owner: second, sourcePlayer: expandingName, scenario: await createScenario(second, content("M7 upgrade: NFKC-expanding player", expandingName)) },
  ];
  const reviewed = await createScenario(second, content("M7 upgrade: preserved pending review", "M7 Draft Only Player"), false);
  const emptyDraft = await creatorCommand(second, "create_creator_scenario", { p_request_id: randomUUID() });
  let withdrawn = await createScenario(creator, content("M7 upgrade: original uploaded version", "M7   Media Player", upload.video.id));
  const activeSingle = await start(singleLearner, withdrawn.id);
  withdrawn = await saveReviewed(creator, withdrawn, content("M7 upgrade: later uploaded version", "M7 Media Player", upload.video.id));
  withdrawn = await creatorCommand(creator, "unpublish_creator_scenario", { p_scenario_id: withdrawn.id,
    p_request_id: randomUUID(), p_expected_revision: withdrawn.revision });
  const uploadedLive = await createScenario(creator, content("M7 upgrade: published uploaded source", "m7 media player", upload.video.id));
  const completedDemo = await start(creator);
  completedDemo.session = await finish(creator, completedDemo.session);
  const completedSingle = await start(creator, live.id);
  completedSingle.session = await finish(creator, completedSingle.session);
  const seeds = JSON.parse(sql(target, "select jsonb_agg(id order by sort_order,id) from public.scenarios where is_demo;"));
  assert.equal(seeds.length, 3);
  const completedCurated = await start(creator, seeds[0]);
  completedCurated.session = await finish(creator, completedCurated.session);
  const activeDemo = await start(demoLearner);
  const oldAnswer = await answer(demoLearner, activeDemo.session);
  const oldAdvance = await advance(demoLearner, oldAnswer.session);
  activeDemo.session = oldAdvance.session;
  assert.equal(activeDemo.session.currentIndex, 1);
  assert.equal(withdrawn.publication.state, "withdrawn");

  // Include a deliberate alias in addition to the automatically normalized name mappings.
  sql(target, `insert into private.player_aliases(normalized_key,player_id) values('m7 preserved alias','${TENZ_PLAYER_ID}');`);
  const guest = { client: client(env) };
  const catalogue = {
    tenz: await rpc(guest, "get_library_player", { p_player_id: TENZ_PLAYER_ID }),
    alias: await rpc(guest, "list_library_players", { p_query: "m7 preserved alias" }),
    scenarios: await rpc(guest, "list_library_previews", { p_player_id: TENZ_PLAYER_ID, p_limit: 50 }),
    media: await rpc(guest, "list_library_players", { p_query: "m7 media" }),
  };
  return { creator, second, demoLearner, singleLearner, live, variant, reviewed, emptyDraft, withdrawn, uploadedLive,
    upload, legacyNames, completedDemo, completedSingle, completedCurated, activeDemo, activeSingle, oldAnswer, oldAdvance, seeds, catalogue };
}

// Capture every existing application table and its exact old columns. After M7 adds nullable
// session columns, compare the complete old column set instead of ignoring whole session rows.
export function snapshotM6Records(target, previous) {
  const relations = previous ? Object.values(previous.tables).map(({ schema, name, columns }) => ({ schema, name, columns }))
    : JSON.parse(sql(target, `select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')
      and (n.nspname in ('public','private') or (n.nspname='auth' and c.relname in ('users','identities'))
        or (n.nspname='storage' and c.relname in ('buckets','objects')));`));
  const tables = {};
  for (const relation of relations) {
    const qualified = `${identifier(relation.schema)}.${identifier(relation.name)}`;
    const actualColumns = JSON.parse(sql(target, `select jsonb_agg(attname order by attnum) from pg_attribute
      where attrelid=${literal(qualified)}::regclass and attnum>0 and not attisdropped;`));
    const columns = relation.columns ?? actualColumns;
    for (const column of columns) assert.ok(actualColumns.includes(column), `M7 must retain old column ${relation.name}.${column}`);
    const serialized = sql(target, `select coalesce(jsonb_agg(value order by value::text),'[]'::jsonb)
      from (select to_jsonb(t) value from (select ${columns.map(identifier).join(",")} from ${qualified}) t) records;`);
    tables[`${relation.schema}.${relation.name}`] = { schema: relation.schema, name: relation.name, columns,
      count: JSON.parse(serialized).length, sha256: sha256(serialized) };
  }
  const roleNames = previous?.roles.names ?? JSON.parse(sql(target, "select jsonb_agg(rolname order by rolname) from pg_roles where rolname like 'wyp_%' or rolname in ('anon','authenticated');"));
  const roles = sql(target, `select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,
    'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls) order by rolname)
    from pg_roles where rolname in (${roleNames.map(literal).join(",")});`);
  // No hashes, emails, tokens, review text or video object paths are included in failure output.
  return { tables, roles: { names: roleNames, count: JSON.parse(roles).length, sha256: sha256(roles) } };
}

function assertMetadataOnly(value) {
  const forbidden = new Set(["email", "creatorId", "ownerId", "userId", "review", "draft", "question", "options", "answerKey",
    "analysis", "observedAction", "outcomeText", "takeaway", "setup", "decision", "reveal", "assetId", "signedUrl", "objectPath", "bucket"]);
  const visit = (nested) => {
    if (!nested || typeof nested !== "object") return;
    for (const [key, child] of Object.entries(nested)) {
      assert.equal(forbidden.has(key), false, `Public playlist metadata must not expose ${key}`);
      visit(child);
    }
  };
  visit(value);
}

export async function assertM6Preserved(target, before, baseline, env) {
  assert.deepEqual(snapshotM6Records(target, before), before,
    "M7 must preserve every old account, application row/column, player alias/mapping, source/review, upload reference, session, answer and command receipt");
  assert.equal(sql(target, "select version from supabase_migrations.schema_migrations order by version desc limit 1;"), LAST_PLAYLIST_MIGRATION);
  assert.equal(Number(sql(target, "select count(*) from public.training_sessions where target_playlist_id is not null or target_playlist_version_id is not null or target_playlist_metadata is not null;")), 0,
    "Existing demo/single sessions are not retargeted or populated with playlist metadata");
  const users = [baseline.creator, baseline.second, baseline.demoLearner, baseline.singleLearner];
  for (const user of users) {
    user.client = client(env);
    assert.equal((await user.client.auth.signInWithPassword({ email: user.email, password: user.password })).error?.message ?? null, null,
      "Old verified accounts and passwords remain usable");
  }
  const originals = [[baseline.creator, baseline.live], [baseline.second, baseline.variant], [baseline.second, baseline.reviewed],
    [baseline.second, baseline.emptyDraft], [baseline.creator, baseline.withdrawn], [baseline.creator, baseline.uploadedLive],
    ...baseline.legacyNames.map(({ owner, scenario }) => [owner, scenario])];
  for (const [user, original] of originals)
    assert.deepEqual(await rpc(user, "get_creator_scenario", { p_scenario_id: original.id }), original,
      "Old authoring/review/publication response stays identical");
  for (const user of [baseline.creator, baseline.second]) {
    for (const command of user.creatorCommands) {
      const replay = await rpc(user, command.method, command.input);
      assert.equal(replay.replayed, true, `Old ${command.method} receipt still replays`);
      assert.equal(replay.publishedVersion, command.publishedVersion);
      assert.deepEqual(replay.scenario, originals.find(([owner, scenario]) => owner === user && scenario.id === command.scenarioId)[1]);
    }
    assert.deepEqual(await rpc(user, "get_creator_profile"), { displayName: null, revision: 0 },
      "New public credit remains unset rather than derived from old account email");
  }
  for (const [user, entry] of [[baseline.creator, baseline.completedDemo], [baseline.creator, baseline.completedSingle],
    [baseline.creator, baseline.completedCurated], [baseline.demoLearner, baseline.activeDemo], [baseline.singleLearner, baseline.activeSingle]]) {
    assert.deepEqual(await rpc(user, "get_training_session", { p_session_id: entry.session.id }), entry.session,
      "Every old session response retains its original target, item order, versions, phase and answers");
    const replay = await rpc(user, entry.method, entry.input);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.session, entry.session);
  }
  for (const [method, input] of [["submit_session_answer", baseline.oldAnswer.input], ["advance_training_session", baseline.oldAdvance.input]]) {
    const replay = await rpc(baseline.demoLearner, method, input);
    assert.equal(replay.replayed, true, `Pre-M7 ${method} remains idempotent`);
    assert.deepEqual(replay.session, baseline.activeDemo.session);
  }
  assert.equal((await rpc(baseline.demoLearner, "get_active_training_session")).id, baseline.activeDemo.session.id);
  assert.equal((await rpc(baseline.singleLearner, "get_active_training_session")).id, baseline.activeSingle.session.id);
  const history = await rpc(baseline.creator, "list_training_sessions", { p_limit: 100 });
  for (const entry of [baseline.completedDemo, baseline.completedSingle, baseline.completedCurated])
    assert.equal(history.sessions.find((item) => item.id === entry.session.id)?.status, "completed");
  assert.ok((await baseline.second.client.rpc("get_training_session", { p_session_id: baseline.activeSingle.session.id })).error,
    "Playlist support does not weaken ownership of old sessions");

  const guest = { client: client(env) };
  assert.deepEqual(await rpc(guest, "get_library_player", { p_player_id: TENZ_PLAYER_ID }), baseline.catalogue.tenz);
  assert.deepEqual(await rpc(guest, "list_library_players", { p_query: "m7 preserved alias" }), baseline.catalogue.alias);
  assert.deepEqual(await rpc(guest, "list_library_previews", { p_player_id: TENZ_PLAYER_ID, p_limit: 50 }), baseline.catalogue.scenarios);
  assert.deepEqual(await rpc(guest, "list_library_players", { p_query: "m7 media" }), baseline.catalogue.media);
  for (const { sourcePlayer, scenario } of baseline.legacyNames) {
    const preview = await rpc(guest, "get_library_preview", { p_scenario_id: scenario.id });
    assert.equal(preview.source.player, sourcePlayer);
    assert.equal(preview.player.displayName, sourcePlayer.normalize("NFKC"));
  }

  const access = { kind: "session-item", sessionId: baseline.activeSingle.session.id, itemId: baseline.activeSingle.session.items[0].id, phase: "setup" };
  assert.equal((await rpc(baseline.singleLearner, "authorize_video_playback", { p_context: access })).assetId, baseline.upload.video.id);
  assert.ok((await baseline.singleLearner.client.rpc("authorize_video_playback", { p_context: { ...access, phase: "reveal" } })).error,
    "An old unanswered item still cannot reveal continuation");
  assert.ok((await guest.client.rpc("authorize_video_playback", { p_context: { kind: "library-scenario", scenarioId: baseline.uploadedLive.id } })).error);
  const downloaded = await client(env, true).storage.from("creator-vods").download(baseline.upload.objectPath);
  assert.equal(downloaded.error?.message ?? null, null);
  assert.equal(sha256(Buffer.from(await downloaded.data.arrayBuffer())), baseline.upload.sha256, "Original validated video bytes survive M7");
  for (const [method, input] of [["create_creator_video", baseline.upload.reservation], ["complete_creator_video_upload", baseline.upload.completion]]) {
    const replay = await rpc(baseline.creator, method, input);
    assert.equal(replay.replayed, true, `Pre-M7 ${method} receipt remains reusable`);
    assert.equal(replay.video.id, baseline.upload.video.id);
    assert.equal(replay.video.state, "ready");
  }
  const answered = (await answer(baseline.singleLearner, baseline.activeSingle.session)).session;
  assert.equal((await rpc(baseline.singleLearner, "authorize_video_playback", { p_context: { ...access, phase: "reveal" } })).assetId, baseline.upload.video.id);
  assert.equal((await finish(baseline.singleLearner, answered)).phase, "completed");
  assert.equal((await finish(baseline.demoLearner, baseline.activeDemo.session)).phase, "completed");
  assert.ok((await baseline.singleLearner.client.rpc("start_selected_training_session", { p_request_id: randomUUID(),
    p_target: { kind: "scenario", scenarioId: baseline.withdrawn.id } })).error, "Old withdrawal still blocks new sessions");
  const publishedReview = await rpc(baseline.second, "publish_creator_scenario", { p_scenario_id: baseline.reviewed.id,
    p_request_id: randomUUID(), p_expected_revision: baseline.reviewed.revision, p_review_id: baseline.reviewed.review.id });
  assert.equal(publishedReview.scenario.publication.state, "published", "A pre-M7 scenario review still authorizes its exact saved content");

  const fixture = JSON.parse(readFileSync(new URL("../../supabase/fixtures/curated-playlist.json", import.meta.url), "utf8"));
  const starter = await rpc(guest, "get_library_playlist", { p_playlist_id: fixture.id });
  assert.equal(starter.id, fixture.id);
  assert.equal(starter.publicationVersion, fixture.publicationVersion);
  assert.equal(starter.title, fixture.title);
  assert.equal(starter.description, fixture.description);
  assert.deepEqual(starter.credit, { kind: "editorial", displayName: "Would You Peek" });
  assert.deepEqual(starter.items.map(({ scenarioId, scenarioVersion }) => ({ scenarioId, scenarioVersion })), fixture.items);
  assert.deepEqual(starter.items.map(({ scenarioId }) => scenarioId), baseline.seeds, "Migration-only starter retains the original three-item sequence");
  assert.equal(starter.itemCount, 3);
  assert.ok(starter.items.every((item) => item.player.id === TENZ_PLAYER_ID && item.provenance === "ai" && item.sourceKind === "youtube"));
  assertMetadataOnly(starter);
  assert.ok((await rpc(guest, "list_library_playlists", { p_player_id: TENZ_PLAYER_ID })).playlists.some(({ id }) => id === fixture.id));
  assert.equal(sql(target, `select creator_id is null from public.playlists where id=${literal(fixture.id)}::uuid;`), "t",
    "The curated collection does not manufacture a creator account");
  sql(target, "select private.ensure_curated_starter_playlist();");
  assert.deepEqual(await rpc(guest, "get_library_playlist", { p_playlist_id: fixture.id }), starter,
    "Repeated migration/seed initialization verifies rather than rewrites the starter");
  const startInput = { p_request_id: randomUUID(), p_playlist_id: fixture.id, p_expected_publication_version: fixture.publicationVersion };
  assert.ok((await guest.client.rpc("start_playlist_training_session", startInput)).error, "Public metadata does not grant anonymous play");
  const started = await rpc(baseline.creator, "start_playlist_training_session", startInput);
  assert.equal(started.created, true);
  assert.deepEqual(started.session.target, { kind: "playlist", playlistId: fixture.id });
  assert.deepEqual(started.session.items.map(({ challenge }) => challenge.id), baseline.seeds);
  assert.equal(started.session.playlist.publicationVersion, fixture.publicationVersion);
  assert.equal((await rpc(baseline.creator, "start_playlist_training_session", startInput)).replayed, true);
  assert.equal((await finish(baseline.creator, started.session)).phase, "completed", "Migrated starter works through the existing saved-session engine");
  for (const scenarioId of baseline.seeds) {
    const single = await start(baseline.creator, scenarioId);
    assert.deepEqual(single.session.target, { kind: "scenario", scenarioId });
    assert.equal(single.session.items.length, 1, "The starter playlist does not replace individual curated starts");
    assert.equal("playlist" in single.session, false, "Legacy targets retain their response shape");
    await finish(baseline.creator, single.session);
  }
}

export async function runPlaylistMigrationPreservation(env = process.env) {
  const target = assertDisposableTarget(env);
  assertM6Boundary(target);
  let worker, baseline;
  try {
    await runTestCommand(process.execPath, ["scripts/generate-video-fixtures.mjs"], { cwd: target.workspace, env });
    worker = await startTestMediaWorker(target, env);
    baseline = await createM6Baseline(target, env);
  } finally {
    if (worker) await stopTestApp(worker);
  }
  // Stop all fixture writers before taking complete old-column/account/media digests.
  const before = snapshotM6Records(target);
  await applyPendingMigrations(target, { through: LAST_PLAYLIST_MIGRATION });
  await assertM6Preserved(target, before, baseline, env);
  console.log("Playlist upgrade preservation passed: all M6 columns/rows, accounts/roles, player identities, real upload bytes, old review/command receipts and demo/single sessions survived; curated playlist starts and completes without reseeding.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runPlaylistMigrationPreservation();
}
