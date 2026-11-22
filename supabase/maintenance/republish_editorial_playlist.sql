-- Trusted, explicit repair of the fixed editorial starter only. Never run at app startup.
-- Invoke as postgres with psql -X --single-transaction -v ON_ERROR_STOP=1 -f this-file.
-- Required psql variables: playlist_id, expected_publication_id, reviewed_sources,
-- reviewed_by, review_reason. reviewed_sources is an explicitly reviewed JSON array:
-- [{"scenarioId":"...","scenarioVersion":"vod-1","availabilityGeneration":1}, ...]
-- Keep the three canonical scenarios in their original order. All selected versions
-- must still be current, published, unhidden and ready. Save the emitted JSON as
-- operational evidence. There is no public RPC and no existing publication is edited.
-- AUTOCOMMIT off makes omission of --single-transaction fail closed (no durable repair).
\set ON_ERROR_STOP on
\set AUTOCOMMIT off

do $role$
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'EDITORIAL_REPAIR_REQUIRES_POSTGRES';
  end if;
end;
$role$;

create temporary table wyp_editorial_republish_input (
  playlist_id uuid not null,
  expected_publication_id uuid not null,
  reviewed_sources jsonb not null,
  reviewed_by text not null,
  review_reason text not null
) on commit drop;
insert into pg_temp.wyp_editorial_republish_input values (
  :'playlist_id'::uuid, :'expected_publication_id'::uuid,
  :'reviewed_sources'::jsonb, :'reviewed_by', :'review_reason'
);
create temporary table wyp_editorial_republish_evidence (result jsonb not null) on commit drop;

do $repair$
declare
  input pg_temp.wyp_editorial_republish_input;
  playlist public.playlists;
  previous private.playlist_versions;
  source public.scenarios;
  version public.scenario_versions;
  selection jsonb;
  lock_scenario_id text;
  ordered_ids text[];
  starter_id constant uuid := '7ecf3523-18cb-5cbe-a307-5b5cd43d1836';
  starter_sources constant text[] := array[
    'bind-clove-utility-window', 'bind-clove-smoke-contest', 'bind-clove-advantage-reset'
  ];
  previews jsonb := '[]'::jsonb;
  content jsonb;
  players jsonb;
  new_publication_id uuid := gen_random_uuid();
  publication_sequence integer;
  publication_time timestamptz := clock_timestamp();
begin
  select * into strict input from pg_temp.wyp_editorial_republish_input;
  if input.playlist_id <> starter_id then raise exception 'EDITORIAL_REPAIR_TARGET_MISMATCH'; end if;
  if length(btrim(input.reviewed_by)) not between 1 and 120
    or length(btrim(input.review_reason)) not between 1 and 1000 then
    raise exception 'EDITORIAL_REPAIR_REVIEW_REQUIRED';
  end if;
  if jsonb_typeof(input.reviewed_sources) is distinct from 'array' then
    raise exception 'EDITORIAL_REPAIR_INVALID_SOURCES';
  end if;
  if jsonb_array_length(input.reviewed_sources) <> 3 then
    raise exception 'EDITORIAL_REPAIR_INVALID_SOURCES';
  end if;
  for selection in select value from jsonb_array_elements(input.reviewed_sources) loop
    if jsonb_typeof(selection) is distinct from 'object' then
      raise exception 'EDITORIAL_REPAIR_INVALID_SOURCES';
    end if;
    if (select array_agg(key order by key) from jsonb_object_keys(selection) key)
        is distinct from array['availabilityGeneration','scenarioId','scenarioVersion']
      or jsonb_typeof(selection->'scenarioId') is distinct from 'string'
      or jsonb_typeof(selection->'scenarioVersion') is distinct from 'string'
      or jsonb_typeof(selection->'availabilityGeneration') is distinct from 'number'
      or (selection->>'availabilityGeneration') !~ '^(0|[1-9][0-9]*)$'
      or length(selection->>'scenarioVersion') not between 1 and 80 then
      raise exception 'EDITORIAL_REPAIR_INVALID_SOURCES';
    end if;
  end loop;
  select array_agg(value->>'scenarioId' order by ordinal)
    into ordered_ids from jsonb_array_elements(input.reviewed_sources) with ordinality t(value,ordinal);
  if ordered_ids is distinct from starter_sources then raise exception 'EDITORIAL_REPAIR_ORDER_MISMATCH'; end if;

  -- Match normal playlist authoring/start ordering; never acquire an actor lock here.
  perform pg_advisory_xact_lock(hashtextextended('playlist:'||input.playlist_id::text,7));
  for lock_scenario_id in select unnest(starter_sources) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('scenario:'||lock_scenario_id,2));
  end loop;
  select * into playlist from public.playlists where id=input.playlist_id for update;
  if not found or playlist.kind <> 'editorial' or playlist.creator_id is not null
    or not playlist.is_published then raise exception 'EDITORIAL_REPAIR_TARGET_MISMATCH'; end if;
  if playlist.current_version is distinct from input.expected_publication_id then
    raise exception 'EDITORIAL_REPAIR_PUBLICATION_CHANGED';
  end if;
  select * into strict previous from private.playlist_versions
    where id=input.expected_publication_id and playlist_id=input.playlist_id;
  if (select array_agg(i.scenario_id order by i.position) from private.playlist_version_items i
      where i.publication_id=previous.id) is distinct from starter_sources then
    raise exception 'EDITORIAL_REPAIR_ORDER_MISMATCH';
  end if;
  for selection in select value from jsonb_array_elements(input.reviewed_sources) loop
    select * into source from public.scenarios where id=selection->>'scenarioId';
    if not found or not source.is_demo or not private.scenario_publicly_available(source.id) then
      raise exception 'EDITORIAL_REPAIR_SOURCE_UNAVAILABLE';
    end if;
    select * into version from public.scenario_versions
      where id=source.current_version and scenario_id=source.id and content_version=selection->>'scenarioVersion';
    if not found then raise exception 'EDITORIAL_REPAIR_SOURCE_CHANGED'; end if;
    if private.current_scenario_availability_generation(source.id)::numeric
      <> (selection->>'availabilityGeneration')::numeric then
      raise exception 'EDITORIAL_REPAIR_GENERATION_CHANGED';
    end if;
    if not private.playlist_version_media_ready(version.id)
      or private.playlist_item_preview(version.id) is null then
      raise exception 'EDITORIAL_REPAIR_MEDIA_UNAVAILABLE';
    end if;
    previews := previews || jsonb_build_array(private.playlist_item_preview(version.id));
  end loop;
  content := jsonb_build_object('title',previous.title,'description',previous.description,'items',
    (select jsonb_agg(jsonb_build_object('scenarioId',value->'scenarioId','scenarioVersion',value->'scenarioVersion') order by ordinal)
      from jsonb_array_elements(input.reviewed_sources) with ordinality t(value,ordinal)));
  select jsonb_agg(player order by position) into players from (
    select distinct on (value->'player'->>'id') value->'player' player, ordinal position
    from jsonb_array_elements(previews) with ordinality t(value,ordinal)
    order by value->'player'->>'id',ordinal
  ) p;
  select coalesce(max(sequence),0)+1 into publication_sequence
    from private.playlist_versions where playlist_id=input.playlist_id;
  insert into private.playlist_versions(id,playlist_id,sequence,title,description,credit,players,content,checksum,published_at)
    values(new_publication_id,input.playlist_id,publication_sequence,previous.title,previous.description,
      previous.credit,players,content,md5(content::text),publication_time);
  insert into private.playlist_version_items(publication_id,position,scenario_version_id,scenario_id,availability_generation,preview)
    select new_publication_id,(ordinal-1)::integer,v.id,v.scenario_id,
      (chosen.value->>'availabilityGeneration')::bigint,previews->(ordinal-1)::integer
    from jsonb_array_elements(input.reviewed_sources) with ordinality chosen(value,ordinal)
    join public.scenario_versions v on v.scenario_id=chosen.value->>'scenarioId'
      and v.content_version=chosen.value->>'scenarioVersion';
  insert into private.playlist_version_players(publication_id,player_id,display_name,position)
    select new_publication_id,(value->>'id')::uuid,value->>'displayName',(ordinal-1)::integer
    from jsonb_array_elements(players) with ordinality t(value,ordinal);
  update public.playlists set current_version=new_publication_id,
    published_at=publication_time,updated_at=publication_time where id=input.playlist_id;
  insert into pg_temp.wyp_editorial_republish_evidence values(jsonb_build_object(
    'playlistId',input.playlist_id,'previousPublicationId',previous.id,'publicationId',new_publication_id,
    'sequence',publication_sequence,'reviewedSources',input.reviewed_sources,
    'reviewedBy',btrim(input.reviewed_by),'reviewReason',btrim(input.review_reason),
    'databaseRole',current_user,'publishedAt',publication_time
  ));
end;
$repair$;
select result from pg_temp.wyp_editorial_republish_evidence;
drop table pg_temp.wyp_editorial_republish_evidence;
drop table pg_temp.wyp_editorial_republish_input;
