begin;
grant create on schema public,private to wyp_creator_rpc,wyp_rpc,wyp_video_rpc;
do $$ begin
 if not exists(select 1 from pg_roles where rolname='wyp_playlist_fence') then
  create role wyp_playlist_fence nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 elsif exists(select 1 from pg_roles where rolname='wyp_playlist_fence' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then raise exception 'Unsafe playlist fence role'; end if;
end $$;
grant wyp_playlist_fence to postgres with set true;
grant usage,create on schema private to wyp_playlist_fence;
create table private.creator_profiles(user_id uuid primary key references auth.users(id),display_name text not null,revision integer not null check(revision>0),updated_at timestamptz not null default now());
create table private.creator_profile_commands(actor_id uuid not null references auth.users(id),request_id uuid not null,payload jsonb not null,fingerprint text not null,resulting_revision integer not null,primary key(actor_id,request_id));
create table public.playlists(
 id uuid primary key default gen_random_uuid(),creator_id uuid references auth.users(id),kind text not null check(kind in ('creator','editorial')),
 current_version uuid,is_published boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),first_published_at timestamptz,published_at timestamptz,
 check((kind='creator' and creator_id is not null) or (kind='editorial' and creator_id is null)));
create index playlists_owner_page on public.playlists(creator_id,created_at desc,id desc);
create index playlists_public_page on public.playlists(first_published_at desc,id desc) where is_published;
create table private.playlist_drafts(
 playlist_id uuid primary key references public.playlists(id),revision integer not null default 0 check(revision>=0),draft_revision integer not null default 0 check(draft_revision>=0),
 content jsonb not null,checksum text not null,review_id uuid,saved_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table private.playlist_reviews(
 id uuid primary key default gen_random_uuid(),playlist_id uuid not null references public.playlists(id),reviewer_id uuid not null references auth.users(id),draft_revision integer not null,
 content jsonb not null,checksum text not null,profile_revision integer not null,credit jsonb not null,checklist jsonb not null,dependencies jsonb not null,reviewed_at timestamptz not null default now());
alter table private.playlist_drafts add foreign key(review_id) references private.playlist_reviews(id);
create table private.playlist_versions(
 id uuid primary key default gen_random_uuid(),playlist_id uuid not null references public.playlists(id),sequence integer not null check(sequence>0),
 title text not null,description text not null,credit jsonb not null,players jsonb not null,content jsonb not null,checksum text not null,review_id uuid references private.playlist_reviews(id),published_at timestamptz not null default now(),
 unique(id,playlist_id),unique(playlist_id,sequence));
alter table public.playlists add foreign key(current_version,id) references private.playlist_versions(id,playlist_id) deferrable initially deferred;
create table private.playlist_version_items(
 publication_id uuid not null references private.playlist_versions(id),position integer not null check(position between 0 and 19),
 scenario_version_id uuid not null,scenario_id text not null,availability_generation bigint not null check(availability_generation>=0),preview jsonb not null,
 primary key(publication_id,position),unique(publication_id,scenario_id),foreign key(scenario_version_id,scenario_id) references public.scenario_versions(id,scenario_id));
create index playlist_items_scenario on private.playlist_version_items(scenario_id,publication_id);
create table private.playlist_version_players(publication_id uuid not null references private.playlist_versions(id),player_id uuid not null references public.players(id),display_name text not null,position integer not null,primary key(publication_id,player_id));
create index playlist_players_lookup on private.playlist_version_players(player_id,publication_id);
create table private.playlist_commands(actor_id uuid not null references auth.users(id),request_id uuid not null,operation text not null check(operation in ('create','save','review','publish','unpublish')),payload jsonb not null,fingerprint text not null,playlist_id uuid not null references public.playlists(id),resulting_revision integer not null,published_version uuid references private.playlist_versions(id),primary key(actor_id,request_id));
create table private.scenario_availability_fences(scenario_id text primary key references public.scenarios(id),generation bigint not null check(generation>0),last_withdrawn_at timestamptz not null default now());

-- Browser roles receive only named wrappers, never direct access to these records.
do $$ declare t text; begin
 foreach t in array array['creator_profiles','creator_profile_commands','playlist_drafts','playlist_reviews','playlist_versions','playlist_version_items','playlist_version_players','playlist_commands','scenario_availability_fences'] loop
  execute format('alter table private.%I enable row level security',t);execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;
alter table public.playlists enable row level security;alter table public.playlists force row level security;
revoke all on public.playlists from public,anon,authenticated;
grant select,insert on public.playlists to wyp_creator_rpc;
grant update(current_version,is_published,updated_at,first_published_at,published_at) on public.playlists to wyp_creator_rpc;
grant select on public.playlists to wyp_rpc;
create policy playlists_owner on public.playlists for all to wyp_creator_rpc using(creator_id=private.current_user_id() and kind='creator' and private.creator_allowed()) with check(creator_id=private.current_user_id() and kind='creator' and private.creator_allowed());
create policy playlists_runtime_read on public.playlists for select to wyp_rpc using(true);
grant select,insert on private.creator_profiles to wyp_creator_rpc;
grant update(display_name,revision,updated_at) on private.creator_profiles to wyp_creator_rpc;
create policy creator_profiles_owner on private.creator_profiles for all to wyp_creator_rpc using(user_id=private.current_user_id() and private.creator_allowed()) with check(user_id=private.current_user_id() and private.creator_allowed());
grant select,insert on private.creator_profile_commands,private.playlist_commands to wyp_creator_rpc;
create policy creator_profile_receipts_owner on private.creator_profile_commands for all to wyp_creator_rpc using(actor_id=private.current_user_id() and private.creator_allowed()) with check(actor_id=private.current_user_id() and private.creator_allowed());
create policy playlist_receipts_owner on private.playlist_commands for all to wyp_creator_rpc using(actor_id=private.current_user_id() and private.creator_allowed()) with check(actor_id=private.current_user_id() and private.creator_allowed());
grant select,insert on private.playlist_drafts to wyp_creator_rpc;
grant update(revision,draft_revision,content,checksum,review_id,saved_at,updated_at) on private.playlist_drafts to wyp_creator_rpc;
create policy playlist_drafts_owner on private.playlist_drafts for all to wyp_creator_rpc using(exists(select 1 from public.playlists p where p.id=playlist_id and p.creator_id=private.current_user_id())) with check(exists(select 1 from public.playlists p where p.id=playlist_id and p.creator_id=private.current_user_id()));
grant select,insert on private.playlist_reviews,private.playlist_versions to wyp_creator_rpc;
create policy playlist_reviews_owner on private.playlist_reviews for all to wyp_creator_rpc using(reviewer_id=private.current_user_id() and exists(select 1 from public.playlists p where p.id=playlist_id and p.creator_id=private.current_user_id())) with check(reviewer_id=private.current_user_id() and exists(select 1 from public.playlists p where p.id=playlist_id and p.creator_id=private.current_user_id()));
create policy playlist_versions_owner on private.playlist_versions for all to wyp_creator_rpc using(exists(select 1 from public.playlists p where p.id=playlist_id and p.creator_id=private.current_user_id())) with check(exists(select 1 from public.playlists p where p.id=playlist_id and p.creator_id=private.current_user_id()));
grant select,insert on private.playlist_version_items,private.playlist_version_players to wyp_creator_rpc;
create policy playlist_items_owner on private.playlist_version_items for all to wyp_creator_rpc using(exists(select 1 from private.playlist_versions v join public.playlists p on p.id=v.playlist_id where v.id=publication_id and p.creator_id=private.current_user_id())) with check(exists(select 1 from private.playlist_versions v join public.playlists p on p.id=v.playlist_id where v.id=publication_id and p.creator_id=private.current_user_id()));
create policy playlist_players_owner on private.playlist_version_players for all to wyp_creator_rpc using(exists(select 1 from private.playlist_versions v join public.playlists p on p.id=v.playlist_id where v.id=publication_id and p.creator_id=private.current_user_id())) with check(exists(select 1 from private.playlist_versions v join public.playlists p on p.id=v.playlist_id where v.id=publication_id and p.creator_id=private.current_user_id()));
grant select on private.playlist_versions,private.playlist_version_items,private.playlist_version_players to wyp_rpc;
create policy playlist_versions_runtime on private.playlist_versions for select to wyp_rpc using(true);
create policy playlist_items_runtime on private.playlist_version_items for select to wyp_rpc using(true);
create policy playlist_players_runtime on private.playlist_version_players for select to wyp_rpc using(true);
grant select on private.scenario_availability_fences to wyp_rpc,wyp_creator_rpc,wyp_playlist_fence;
grant insert on private.scenario_availability_fences to wyp_playlist_fence;
grant update(generation,last_withdrawn_at) on private.scenario_availability_fences to wyp_playlist_fence;
create policy playlist_fence_read on private.scenario_availability_fences for select to wyp_rpc,wyp_creator_rpc,wyp_playlist_fence using(true);
create policy playlist_fence_insert on private.scenario_availability_fences for insert to wyp_playlist_fence with check(true);
create policy playlist_fence_update on private.scenario_availability_fences for update to wyp_playlist_fence using(true) with check(true);
do $$ declare t text; begin
 foreach t in array array['playlist_reviews','playlist_versions','playlist_version_items','playlist_version_players','playlist_commands','creator_profile_commands'] loop
  execute format('create trigger immutable_%I before update or delete on private.%I for each row execute function private.reject_immutable_change()',t,t);
 end loop;
end $$;
create function private.note_scenario_withdrawal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.is_published and not new.is_published then
  insert into private.scenario_availability_fences(scenario_id,generation) values(new.id,1)
  on conflict(scenario_id) do update set generation=private.scenario_availability_fences.generation+1,last_withdrawn_at=now();
 end if;return new;
end $$;
alter function private.note_scenario_withdrawal() owner to wyp_playlist_fence;
revoke all on function private.note_scenario_withdrawal() from public,anon,authenticated;
create trigger playlist_source_withdrawal after update of is_published on public.scenarios for each row execute function private.note_scenario_withdrawal();
revoke create on schema private from wyp_playlist_fence;

create function private.playlist_text(p_text text) returns text language sql immutable set search_path='' as $$
 select btrim(regexp_replace(p_text,U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+',' ','g'),' ');
$$;
create function private.playlist_text_safe(p_text text) returns boolean language plpgsql immutable set search_path='' as $$
declare i integer;c integer;begin
 if p_text is null then return false;end if;
 for i in 1..length(p_text) loop c:=ascii(substr(p_text,i,1));if c between 0 and 8 or c between 14 and 31 or c between 127 and 132 or c between 134 and 159 then return false;end if;end loop;return true;
end $$;
create function private.normalize_creator_display_name(p_name text) returns text language plpgsql immutable set search_path='' as $$
declare n text:=private.playlist_text(p_name);begin
 if not private.playlist_text_safe(p_name) or length(n) not between 2 and 50 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;return n;
end $$;
create function private.normalize_playlist_content(p_content jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('title',private.playlist_text(p_content->>'title'),'description',private.creator_trim(p_content->>'description'),'items',coalesce((select jsonb_agg(jsonb_build_object('scenarioId',lower(x->>'scenarioId'),'scenarioVersion',x->>'scenarioVersion') order by n) from jsonb_array_elements(p_content->'items') with ordinality t(x,n)),'[]'::jsonb));
$$;
create function private.validate_playlist_draft(p_content jsonb,p_publish boolean default false) returns jsonb language plpgsql immutable set search_path='' as $$
declare issues jsonb:='[]';x jsonb;i integer:=0;ids text[]:='{}';k text;lim integer;begin
 if p_content is null or octet_length(p_content::text)>16384 or not private.creator_object(p_content,array['title','description','items']) then return private.creator_issue('content','INVALID_SHAPE','Use only the documented playlist fields.');end if;
 foreach k in array array['title','description'] loop lim:=case k when 'title' then 120 else 1000 end;
  if not private.creator_text(p_content->k,lim) or not private.playlist_text_safe(p_content->>k) then issues:=issues||private.creator_issue(k,'INVALID_FIELD','Enter text within the field limit without control characters.');end if;
 end loop;
 if jsonb_typeof(p_content->'items') is distinct from 'array' then issues:=issues||private.creator_issue('items','INVALID_SHAPE','Use an ordered scenario list.');
 elsif jsonb_array_length(p_content->'items')>20 then issues:=issues||private.creator_issue('items','INVALID_FIELD','Choose at most 20 scenarios.');
 else
  for x in select value from jsonb_array_elements(p_content->'items') loop
   if not private.creator_object(x,array['scenarioId','scenarioVersion']) then issues:=issues||private.creator_issue('items.'||i,'INVALID_SHAPE','Choose a scenario and its version.');
   else
    if jsonb_typeof(x->'scenarioId') is distinct from 'string' or not private.is_catalogue_scenario_id(x->>'scenarioId') or lower(x->>'scenarioId')=any(ids) then issues:=issues||private.creator_issue('items.'||i||'.scenarioId','INVALID_FIELD','Choose each scenario once.');end if;
    ids:=array_append(ids,lower(x->>'scenarioId'));
    if jsonb_typeof(x->'scenarioVersion') is distinct from 'string' or x->>'scenarioVersion' !~ '^[A-Za-z0-9._-]{1,100}$' then issues:=issues||private.creator_issue('items.'||i||'.scenarioVersion','INVALID_FIELD','Choose a published version.');end if;
   end if;i:=i+1;
  end loop;
 end if;
 if p_publish and issues='[]'::jsonb then
  if private.playlist_text(p_content->>'title')='' then issues:=issues||private.creator_issue('title','REQUIRED','Add a title before review.');end if;
  if jsonb_array_length(p_content->'items')=0 then issues:=issues||private.creator_issue('items','REQUIRED','Choose at least one published scenario.');end if;
 end if;return issues;
end $$;
create function private.current_scenario_availability_generation(p_id text) returns bigint language sql stable set search_path='' as $$ select coalesce((select generation from private.scenario_availability_fences where scenario_id=p_id),0);$$;
-- Only this metadata projection crosses between authoring and the existing read role.
create function private.playlist_item_preview(p_version_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('scenarioId',v.scenario_id,'scenarioVersion',v.content_version,'title',v.challenge->>'title','topic',v.challenge->>'topic',
 'player',jsonb_build_object('id',p.id,'displayName',p.display_name),'map',v.challenge->'source'->>'map','agent',v.challenge->'source'->>'agent',
 'sourceKind',case when v.challenge->'setup'->>'kind'='uploaded-video' then 'uploaded-video' else 'youtube' end,'provenance',k.answer_key->'analysis'->>'author')
 from public.scenario_versions v join private.scenario_version_players m on m.scenario_version_id=v.id join public.players p on p.id=m.player_id join private.scenario_answer_keys k on k.scenario_version_id=v.id where v.id=p_version_id;
$$;
alter function private.playlist_item_preview(uuid) owner to wyp_rpc;
revoke all on function private.playlist_item_preview(uuid) from public,anon,authenticated;
grant execute on function private.playlist_item_preview(uuid) to wyp_creator_rpc;
create function private.playlist_version_media_ready(p_version_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare kind text;begin
 select challenge->'setup'->>'kind' into kind from public.scenario_versions where id=p_version_id;
 if kind='youtube' then return true;end if;
 if kind is distinct from 'uploaded-video' then return false;end if;
 return exists(select 1 from private.scenario_version_assets r join private.video_assets a on a.id=r.asset_id join storage.objects o on o.bucket_id=a.bucket and o.name=a.object_path where r.version_id=p_version_id and a.state='ready' and a.object_version=o.id::text||':'||coalesce(o.version,''));
end $$;
alter function private.playlist_version_media_ready(uuid) owner to wyp_video_rpc;
revoke all on function private.playlist_version_media_ready(uuid) from public,anon,authenticated,wyp_media_validator;
grant execute on function private.playlist_version_media_ready(uuid) to wyp_rpc,wyp_creator_rpc;
-- Shared pure helpers are invoker functions and confer no table access.
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array['playlist_text','playlist_text_safe','normalize_creator_display_name','normalize_playlist_content','validate_playlist_draft','current_scenario_availability_generation']) loop
  execute format('alter function %s owner to wyp_creator_rpc',f.sig);execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to wyp_rpc',f.sig);
 end loop;
end $$;
grant execute on function private.is_catalogue_scenario_id(text) to wyp_creator_rpc;
revoke create on schema public,private from wyp_creator_rpc,wyp_rpc,wyp_video_rpc;
commit;
