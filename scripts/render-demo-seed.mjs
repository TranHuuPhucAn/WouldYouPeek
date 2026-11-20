import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const fixtureUrl = new URL(
  "../supabase/fixtures/demo-scenarios.json",
  import.meta.url,
);
const curatedFixture = JSON.parse(
  await readFile(
    new URL("../supabase/fixtures/curated-playlist.json", import.meta.url),
    "utf8",
  ),
);
const seedUrl = new URL("../supabase/seed.sql", import.meta.url);

/** Read the canonical JSON directly: this command never imports a server-only module. */
export async function readFixtures(path = fixtureUrl) {
  return validateFixtures(JSON.parse(await readFile(path, "utf8")));
}

/** Reject malformed IDs, choices, disclosure boundaries and clip timing before producing SQL. */
export function validateFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0)
    throw new Error("Fixtures must be a nonempty array.");
  const ids = new Set();
  const orders = new Set();
  for (const scenario of fixtures) {
    if (
      !scenario ||
      typeof scenario !== "object" ||
      !/^[a-z0-9-]+$/.test(scenario.id) ||
      ids.has(scenario.id)
    )
      throw new Error("Scenario IDs must be unique slugs.");
    ids.add(scenario.id);
    if (
      !Number.isInteger(scenario.order) ||
      scenario.order < 1 ||
      orders.has(scenario.order)
    )
      throw new Error("Scenario order must be unique and positive.");
    orders.add(scenario.order);
    for (const key of [
      "contentVersion",
      "title",
      "topic",
      "context",
      "question",
      "takeaway",
      "outcomeText",
    ]) {
      if (typeof scenario[key] !== "string" || !scenario[key].trim())
        throw new Error(`Missing ${key}.`);
    }
    if (!Array.isArray(scenario.options) || scenario.options.length < 2)
      throw new Error("A scenario needs at least two options.");
    const optionIds = new Set();
    for (const option of scenario.options) {
      if (!/^[a-z0-9-]+$/.test(option.id) || optionIds.has(option.id))
        throw new Error("Option IDs must be unique slugs.");
      optionIds.add(option.id);
      if (!["recommended", "reasonable", "risky"].includes(option.assessment))
        throw new Error("Invalid assessment.");
      if (
        typeof option.label !== "string" ||
        !option.label ||
        typeof option.explanation !== "string" ||
        !option.explanation
      )
        throw new Error("Option text is required.");
      for (const key of ["acceptableWhen", "risks"]) {
        if (
          !Array.isArray(option[key]) ||
          !option[key].every((value) => typeof value === "string")
        )
          throw new Error(`Invalid option ${key}.`);
      }
    }
    if (
      !scenario.observedAction ||
      !optionIds.has(scenario.observedAction.optionId)
    )
      throw new Error("Observed action must reference an option.");
    if (
      scenario.setup?.kind !== "youtube" ||
      scenario.reveal?.kind !== "youtube" ||
      scenario.decision?.kind !== "paused-video"
    )
      throw new Error(
        "Demo fixtures require YouTube segments and a paused decision.",
      );
    const times = [
      scenario.setup.startSeconds,
      scenario.setup.endSeconds,
      scenario.decision.atSeconds,
      scenario.reveal.startSeconds,
      scenario.reveal.endSeconds,
    ];
    if (
      !times.every((value) => Number.isFinite(value) && value >= 0) ||
      !(
        times[0] < times[1] &&
        times[1] === times[2] &&
        times[2] === times[3] &&
        times[3] < times[4]
      )
    )
      throw new Error("Invalid setup/decision/reveal timing.");
    if (
      scenario.source?.videoId !== scenario.setup.videoId ||
      scenario.setup.videoId !== scenario.reveal.videoId
    )
      throw new Error("Video sources must agree.");
    if (
      scenario.analysis?.author !== "ai" ||
      !Array.isArray(scenario.analysis.limitations) ||
      !scenario.review ||
      !Array.isArray(scenario.review.evidence)
    )
      throw new Error("Analysis and review provenance are required.");
  }
  for (const scenario of fixtures) {
    if (
      scenario.linkedScenarioId &&
      (!ids.has(scenario.linkedScenarioId) ||
        scenario.linkedScenarioId === scenario.id)
    )
      throw new Error("Invalid linked scenario.");
  }
  return fixtures;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function versionId(scenario) {
  const hash = createHash("sha256")
    .update(`would-you-peek:${scenario.id}:${scenario.contentVersion}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function splitScenario(scenario) {
  const {
    takeaway,
    reveal,
    outcomeText,
    observedAction,
    analysis,
    review,
    options,
    ...safe
  } = scenario;
  const challenge = {
    ...safe,
    options: options.map(({ id, label }) => ({ id, label })),
  };
  const answerKey = {
    recommendedOptionIds: options
      .filter((option) => option.assessment === "recommended")
      .map((option) => option.id),
    optionFeedback: options.map(
      ({ id, assessment, explanation, acceptableWhen, risks }) => ({
        optionId: id,
        assessment,
        explanation,
        acceptableWhen,
        risks,
      }),
    ),
    takeaway,
    reveal,
    outcomeText,
    observedAction,
    analysis,
  };
  return { challenge, answerKey, review };
}

/** Stable version IDs + checksum assertion make repeat seeding harmless and changed versions explicit. */
export function validateCuratedPlaylist(playlist, fixtures) {
  if (
    !playlist ||
    playlist.id !== "7ecf3523-18cb-5cbe-a307-5b5cd43d1836" ||
    playlist.publicationVersion !== "2e061c34-3f9c-58cd-8923-926b353662fc" ||
    playlist.credit?.kind !== "editorial" ||
    playlist.credit?.displayName !== "Would You Peek" ||
    !Array.isArray(playlist.items) ||
    playlist.items.length !== 3
  )
    throw new Error("Invalid curated playlist manifest.");
  const ordered = [...fixtures].sort((a, b) => a.order - b.order);
  if (
    playlist.items.some(
      (item, index) =>
        item.scenarioId !== ordered[index]?.id ||
        item.scenarioVersion !== ordered[index]?.contentVersion,
    )
  )
    throw new Error(
      "Curated playlist must preserve the original demo order and versions.",
    );
  for (const key of ["title", "description"])
    if (typeof playlist[key] !== "string" || !playlist[key].trim())
      throw new Error("Curated playlist text is required.");
  return playlist;
}
export function renderSeedSql(fixtures, playlist = curatedFixture) {
  validateFixtures(fixtures);
  validateCuratedPlaylist(playlist, fixtures);
  const blocks = [...fixtures]
    .sort((a, b) => a.order - b.order)
    .map((scenario) => {
      const id = versionId(scenario);
      const { challenge, answerKey, review } = splitScenario(scenario);
      const checksum = createHash("sha256")
        .update(JSON.stringify(scenario))
        .digest("hex");
      return `-- ${scenario.id} / ${scenario.contentVersion}
do $seed$
begin
  if exists (select 1 from public.scenario_versions where scenario_id = ${sqlLiteral(scenario.id)} and content_version = ${sqlLiteral(scenario.contentVersion)} and (checksum <> ${sqlLiteral(checksum)} or id <> '${id}'::uuid)) then
    raise exception 'Seed content changed under an existing version; increment contentVersion before reseeding.';
  end if;
  insert into public.scenarios(id, title, topic, sort_order, is_published, is_demo)
  values (${sqlLiteral(scenario.id)}, ${sqlLiteral(scenario.title)}, ${sqlLiteral(scenario.topic)}, ${scenario.order}, true, true)
  on conflict (id) do update set title = excluded.title, topic = excluded.topic, sort_order = excluded.sort_order, is_published = true, is_demo = true;
  insert into public.scenario_versions(id, scenario_id, content_version, challenge, checksum)
  values ('${id}', ${sqlLiteral(scenario.id)}, ${sqlLiteral(scenario.contentVersion)}, ${sqlLiteral(JSON.stringify(challenge))}::jsonb, ${sqlLiteral(checksum)})
  on conflict (scenario_id, content_version) do nothing;
  insert into private.scenario_answer_keys(scenario_version_id, answer_key, review)
  values ('${id}', ${sqlLiteral(JSON.stringify(answerKey))}::jsonb, ${sqlLiteral(JSON.stringify(review))}::jsonb)
  on conflict (scenario_version_id) do nothing;
  update public.scenarios set current_version = '${id}' where id = ${sqlLiteral(scenario.id)};
end;
$seed$;`;
    });
  return `-- Generated by scripts/render-demo-seed.mjs. Edit fixtures, then regenerate.\n-- Local/test seed only; never reset a hosted database to apply this file.\nbegin;\nset local standard_conforming_strings = on;\n\n${blocks.join("\n\n")}\n\n-- The migration helper is deliberately not exposed through PostgREST.\ndo $starter$ begin\n  if to_regprocedure('private.ensure_curated_starter_playlist()') is null then return; end if;\n  perform private.ensure_curated_starter_playlist();\n  if not exists (select 1 from public.playlists p join private.playlist_versions v on v.id=p.current_version where p.id=${sqlLiteral(playlist.id)}::uuid and p.kind='editorial' and p.creator_id is null and v.id=${sqlLiteral(playlist.publicationVersion)}::uuid and v.content=${sqlLiteral(JSON.stringify({ title: playlist.title, description: playlist.description, items: playlist.items }))}::jsonb and v.credit=${sqlLiteral(JSON.stringify(playlist.credit))}::jsonb) then raise exception 'Curated starter differs from the canonical manifest.'; end if;\nend $starter$;\n\ncommit;\n`;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const sql = renderSeedSql(await readFixtures());
  if (process.argv.includes("--check")) {
    if ((await readFile(seedUrl, "utf8")) !== sql)
      throw new Error(
        "supabase/seed.sql is stale. Run npm run db:seed:generate.",
      );
    process.stdout.write("Seed matches canonical fixtures.\n");
  } else {
    await writeFile(seedUrl, sql);
    process.stdout.write(`Wrote ${fileURLToPath(seedUrl)}.\n`);
  }
}
