import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createVerifiedTestUser, type TestUser } from "./helpers/test-users";
import {
  createOperator,
  moderationSql,
  sqlLiteral,
} from "./helpers/moderation";

const starter = "7ecf3523-18cb-5cbe-a307-5b5cd43d1836";
const firstScenario = "bind-clove-utility-window";
// Execute the tracked artifact verbatim, not a test-only copy of its logic.
const repairScript = readFileSync(
  new URL(
    "../../supabase/maintenance/republish_editorial_playlist.sql",
    import.meta.url,
  ),
  "utf8",
);

function claims(user: TestUser) {
  return `select set_config('request.jwt.claims',${sqlLiteral(JSON.stringify({ sub: user.id, role: "authenticated" }))},true);`;
}

function invocation(
  options: {
    playlistId?: string;
    expectedPublication?: string;
    sourcesExpression?: string;
  } = {},
) {
  return `select
    ${sqlLiteral(options.playlistId ?? starter)} as playlist_id,
    ${options.expectedPublication ? sqlLiteral(options.expectedPublication) : `(select current_version::text from public.playlists where id='${starter}')`} as expected_publication_id,
    (${options.sourcesExpression ?? `select jsonb_agg(jsonb_build_object('scenarioId',i.scenario_id,'scenarioVersion',v.content_version,'availabilityGeneration',private.current_scenario_availability_generation(i.scenario_id)) order by i.position) from private.playlist_version_items i join public.scenario_versions v on v.id=i.scenario_version_id where i.publication_id=(select current_version from public.playlists where id='${starter}')`})::text as reviewed_sources,
    'Disposable test reviewer' as reviewed_by,
    'Reviewed the source moments after restoring availability.' as review_reason
    \\gset
  `;
}

function expectedFailure(sql: string, code: string) {
  let diagnostic = "";
  try {
    moderationSql(`begin;\n${sql}\nrollback;`);
  } catch (error) {
    const failure = error as { stderr?: Buffer | string };
    diagnostic = failure.stderr?.toString() ?? "";
  }
  expect(
    diagnostic,
    "The actual maintenance script must reject this input",
  ).toContain(code);
}

describe("trusted editorial starter maintenance", () => {
  let operator: TestUser;
  let learner: TestUser;
  beforeAll(async () => {
    operator = await createOperator();
    learner = await createVerifiedTestUser();
  });

  function hideRestore(restore = true) {
    return `${claims(operator)}
      select public.set_operator_scenario_visibility('${firstScenario}','${randomUUID()}',0,true,'Recheck the editorial source.');
      ${restore ? `select public.set_operator_scenario_visibility('${firstScenario}','${randomUUID()}',1,false,'Source reviewed and restored.');` : ""}
    `;
  }

  it("repairs hide→restore with a new immutable publication and preserves old sessions and source snapshots", () => {
    const before = moderationSql(
      `select current_version from public.playlists where id='${starter}';`,
    );
    const output = moderationSql(`begin;
      ${claims(learner)}
      create temporary table saved_session as select public.start_playlist_training_session('${randomUUID()}','${starter}',(select current_version from public.playlists where id='${starter}'))->'session' snapshot;
      create temporary table old_publication as select to_jsonb(v) snapshot from private.playlist_versions v where v.id=(select current_version from public.playlists where id='${starter}');
      create temporary table old_items as select jsonb_agg(to_jsonb(i) order by position) snapshot from private.playlist_version_items i where publication_id=(select current_version from public.playlists where id='${starter}');
      create temporary table old_players as select jsonb_agg(to_jsonb(p) order by position) snapshot from private.playlist_version_players p where publication_id=(select current_version from public.playlists where id='${starter}');
      create temporary table old_sources as select jsonb_agg(to_jsonb(v) order by v.id) snapshot from public.scenario_versions v join public.scenarios s on s.id=v.scenario_id where s.is_demo;
      create temporary table old_session_row as select to_jsonb(s) snapshot from public.training_sessions s where id=(select (snapshot->>'id')::uuid from saved_session);
      ${hideRestore()}
      do $$ begin
        if private.playlist_publication_available((select current_version from public.playlists where id='${starter}')) then raise exception 'Restore must leave old editorial publication unavailable'; end if;
      end $$;
      ${invocation()}
      ${repairScript}
      ${claims(learner)}
      do $$ declare old_id uuid:=(select (snapshot->>'id')::uuid from old_publication); new_id uuid:=(select current_version from public.playlists where id='${starter}'); begin
        if old_id=new_id or not private.playlist_publication_available(new_id) then raise exception 'Repair must create an available new publication'; end if;
        if (select snapshot from old_publication) is distinct from (select to_jsonb(v) from private.playlist_versions v where id=old_id) then raise exception 'Old publication changed'; end if;
        if (select snapshot from old_items) is distinct from (select jsonb_agg(to_jsonb(i) order by position) from private.playlist_version_items i where publication_id=old_id) then raise exception 'Old items changed'; end if;
        if (select snapshot from old_players) is distinct from (select jsonb_agg(to_jsonb(p) order by position) from private.playlist_version_players p where publication_id=old_id) then raise exception 'Old player snapshots changed'; end if;
        if (select snapshot from old_sources) is distinct from (select jsonb_agg(to_jsonb(v) order by v.id) from public.scenario_versions v join public.scenarios s on s.id=v.scenario_id where s.is_demo) then raise exception 'Source versions changed'; end if;
        if (select snapshot from saved_session) is distinct from public.get_training_session((select (snapshot->>'id')::uuid from saved_session)) then raise exception 'Saved session changed'; end if;
        if (select snapshot from old_session_row) is distinct from (select to_jsonb(s) from public.training_sessions s where id=(select (snapshot->>'id')::uuid from saved_session)) then raise exception 'Pinned session metadata changed'; end if;
        if (select count(*) from private.playlist_version_items where publication_id=new_id)<>3 then raise exception 'Repair changed the item count'; end if;
        if exists(select 1 from private.playlist_version_items where publication_id=new_id and availability_generation<>private.current_scenario_availability_generation(scenario_id)) then raise exception 'New publication did not capture current generations'; end if;
        if (select players from private.playlist_versions where id=new_id) is distinct from (select jsonb_agg(jsonb_build_object('id',player_id,'displayName',display_name) order by position) from private.playlist_version_players where publication_id=new_id) then raise exception 'Player index disagrees with publication'; end if;
      end $$;
      rollback;
    `);
    const evidence = output
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((line) => line?.databaseRole === "postgres");
    expect(evidence).toMatchObject({
      playlistId: starter,
      previousPublicationId: before,
      sequence: 2,
      reviewedBy: "Disposable test reviewer",
      reviewReason: "Reviewed the source moments after restoring availability.",
      reviewedSources: expect.arrayContaining([
        expect.objectContaining({
          scenarioId: firstScenario,
          availabilityGeneration: 1,
        }),
      ]),
    });
    expect(evidence?.publicationId).not.toBe(before);
    // Even a successful test leaves the shared seeded starter unchanged.
    expect(
      moderationSql(
        `select current_version from public.playlists where id='${starter}';`,
      ),
    ).toBe(before);
  });

  it("rejects an expected publication that has changed", () => {
    expectedFailure(
      `${invocation({ expectedPublication: randomUUID() })}${repairScript}`,
      "EDITORIAL_REPAIR_PUBLICATION_CHANGED",
    );
  });

  it("rejects a duplicate invocation with the previous publication ID", () => {
    expectedFailure(
      `${invocation()}${repairScript}\n${repairScript}`,
      "EDITORIAL_REPAIR_PUBLICATION_CHANGED",
    );
  });

  it("rejects a source generation changed after the explicit review", () => {
    expectedFailure(
      `${invocation()}${hideRestore()}${repairScript}`,
      "EDITORIAL_REPAIR_GENERATION_CHANGED",
    );
  });

  it.each(["hidden", "withdrawn"])("rejects a %s source", (state) => {
    const mutation =
      state === "hidden"
        ? hideRestore(false)
        : `update public.scenarios set is_published=false where id='${firstScenario}';`;
    expectedFailure(
      `${mutation}${invocation()}${repairScript}`,
      "EDITORIAL_REPAIR_SOURCE_UNAVAILABLE",
    );
  });

  it("rejects a foreign playlist instead of modifying arbitrary editorial content", () => {
    expectedFailure(
      `${invocation({ playlistId: randomUUID() })}${repairScript}`,
      "EDITORIAL_REPAIR_TARGET_MISMATCH",
    );
  });

  it("requires an explicit postgres administration session", () => {
    expectedFailure(
      `${invocation()}set local role authenticated;\n${repairScript}`,
      "EDITORIAL_REPAIR_REQUIRES_POSTGRES",
    );
  });

  it("rejects a non-editorial target even at the deterministic starter ID", () => {
    expectedFailure(
      `update public.playlists set kind='creator',creator_id='${learner.id}' where id='${starter}';${invocation()}${repairScript}`,
      "EDITORIAL_REPAIR_TARGET_MISMATCH",
    );
  });

  it("rejects a source version that differs from the reviewed current version", () => {
    expectedFailure(
      `${invocation({ sourcesExpression: `select jsonb_agg(jsonb_build_object('scenarioId',i.scenario_id,'scenarioVersion','changed-after-review','availabilityGeneration',private.current_scenario_availability_generation(i.scenario_id)) order by i.position) from private.playlist_version_items i where i.publication_id=(select current_version from public.playlists where id='${starter}')` })}${repairScript}`,
      "EDITORIAL_REPAIR_SOURCE_CHANGED",
    );
  });

  it("rejects a different item order", () => {
    expectedFailure(
      `${invocation({ sourcesExpression: `select jsonb_agg(jsonb_build_object('scenarioId',i.scenario_id,'scenarioVersion',v.content_version,'availabilityGeneration',private.current_scenario_availability_generation(i.scenario_id)) order by i.position desc) from private.playlist_version_items i join public.scenario_versions v on v.id=i.scenario_version_id where i.publication_id=(select current_version from public.playlists where id='${starter}')` })}${repairScript}`,
      "EDITORIAL_REPAIR_ORDER_MISMATCH",
    );
  });
});
