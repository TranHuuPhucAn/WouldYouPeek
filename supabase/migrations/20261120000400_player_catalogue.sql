-- The CLI executes migration statements outside a transaction unless one is explicit.
-- Keep the version-table lock, trigger installation and backfill in one atomic unit.
begin;

-- Canonical identity is additive: historical version JSON, digests and session pins stay intact.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='wyp_player_registry') then
    create role wyp_player_registry nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists(select 1 from pg_roles where rolname='wyp_player_registry' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Unsafe player registry role';
  end if;
end $$;
-- Ownership transfer needs SET membership; browser/authenticator roles receive none.
grant wyp_player_registry to postgres with set true;
grant usage,create on schema public,private to wyp_player_registry;
grant create on schema public,private to wyp_rpc;
grant usage on schema extensions to wyp_player_registry;
grant execute on function extensions.digest(text,text) to wyp_player_registry;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_key text not null,
  key_digest bytea generated always as (extensions.digest(normalized_key,'sha256')) stored unique,
  created_at timestamptz not null default now()
);
create table private.player_aliases (
  normalized_key text not null,
  key_digest bytea generated always as (extensions.digest(normalized_key,'sha256')) stored primary key,
  player_id uuid not null references public.players(id)
);
create table private.scenario_version_players (
  scenario_version_id uuid primary key references public.scenario_versions(id),
  player_id uuid not null references public.players(id)
);
create index scenario_version_players_player_idx on private.scenario_version_players(player_id,scenario_version_id);
alter table public.players enable row level security;
alter table public.players force row level security;
alter table private.player_aliases enable row level security;
alter table private.player_aliases force row level security;
alter table private.scenario_version_players enable row level security;
alter table private.scenario_version_players force row level security;
revoke all on public.players,private.player_aliases,private.scenario_version_players from public,anon,authenticated;
grant select,insert on public.players,private.player_aliases,private.scenario_version_players to wyp_player_registry;
grant select on public.players,private.player_aliases,private.scenario_version_players to wyp_rpc;
create policy players_registry_read on public.players for select to wyp_player_registry,wyp_rpc using(true);
create policy players_registry_insert on public.players for insert to wyp_player_registry with check(true);
create policy aliases_registry_read on private.player_aliases for select to wyp_player_registry,wyp_rpc using(true);
create policy aliases_registry_insert on private.player_aliases for insert to wyp_player_registry with check(true);
create policy mappings_registry_read on private.scenario_version_players for select to wyp_player_registry,wyp_rpc using(true);
create policy mappings_registry_insert on private.scenario_version_players for insert to wyp_player_registry with check(true);

-- Explicit whitespace and ASCII case folding keep JS and PostgreSQL identity rules identical.
create function private.normalize_player_display_name(p_name text) returns text
language plpgsql immutable set search_path='' as $$
declare value text; i integer; code integer;
begin
  if p_name is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  value:=normalize(p_name,NFKC);
  value:=btrim(regexp_replace(value,U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+',' ','g'),' ');
  if length(value)=0 or length(value)>5400 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  for i in 1..length(value) loop
    code:=ascii(substr(value,i,1));
    if code between 0 and 31 or code between 127 and 159 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  end loop;
  return value;
end $$;
create function private.normalize_player_key(p_name text) returns text
language sql immutable set search_path='' as $$
  select translate(private.normalize_player_display_name(p_name),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
$$;
create function private.resolve_player(p_name text) returns uuid
language plpgsql volatile security invoker set search_path='' as $$
declare display text:=private.normalize_player_display_name(p_name); key text:=private.normalize_player_key(p_name);
  digest bytea:=extensions.digest(key,'sha256'); result uuid; existing_key text;
begin
  -- Full normalized keys may expand far past a btree entry; index only their hash.
  -- Hash collisions fail closed and never merge two distinct player names.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('player:'||key,3));
  select player_id,normalized_key into result,existing_key from private.player_aliases where key_digest=digest;
  if found then
    if existing_key<>key then raise exception using errcode='P0001',message='STORAGE_UNAVAILABLE'; end if;
    return result;
  end if;
  insert into public.players(display_name,normalized_key) values(display,key) on conflict(key_digest) do nothing;
  select id,normalized_key into strict result,existing_key from public.players where key_digest=digest;
  if existing_key<>key then raise exception using errcode='P0001',message='STORAGE_UNAVAILABLE'; end if;
  insert into private.player_aliases(normalized_key,player_id) values(key,result) on conflict(key_digest) do nothing;
  if not exists(select 1 from private.player_aliases where key_digest=digest and normalized_key=key and player_id=result) then
    raise exception using errcode='P0001',message='STORAGE_UNAVAILABLE';
  end if;
  return result;
end $$;
create function private.map_scenario_version_player() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(new.challenge->'source'->'player')='string' then
    insert into private.scenario_version_players(scenario_version_id,player_id)
      values(new.id,private.resolve_player(new.challenge->'source'->>'player'));
  end if;
  return new;
end $$;
create function private.reject_player_mapping_change() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='P0001',message='IMMUTABLE_RECORD'; end $$;
create trigger immutable_version_player before update or delete on private.scenario_version_players
  for each row execute function private.reject_player_mapping_change();

-- Stable routing identifier for the original three curated scenarios.
insert into public.players(id,display_name,normalized_key) values('76af0a04-4751-4d26-9233-183a252e124b','TenZ','tenz');
insert into private.player_aliases(normalized_key,player_id) values('tenz','76af0a04-4751-4d26-9233-183a252e124b');
lock table public.scenario_versions in share row exclusive mode;
create trigger map_version_player after insert on public.scenario_versions for each row execute function private.map_scenario_version_player();
do $$ declare version record; player_id uuid; begin
  for version in select id,challenge from public.scenario_versions order by created_at,id loop
    if jsonb_typeof(version.challenge->'source'->'player')='string' then
      begin
        player_id:=private.resolve_player(version.challenge->'source'->>'player');
        insert into private.scenario_version_players values(version.id,player_id);
      exception when sqlstate 'P0001' then
        raise warning 'Player mapping skipped for invalid historical version %',version.id;
      end;
    else
      raise warning 'Player mapping skipped for historical version without a player %',version.id;
    end if;
  end loop;
end $$;

create function private.is_catalogue_scenario_id(p_id text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(length(p_id)<=100 and (p_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_id ~ '^[a-z0-9]+(-[a-z0-9]+)+$'),false);
$$;
create or replace function private.library_preview(p_scenario_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.scenario_preview(v.challenge)||jsonb_build_object(
    'player',jsonb_build_object('id',p.id,'displayName',p.display_name),
    'editorialOrigin',case when s.is_demo then 'curated' else 'creator' end,
    'provenance',k.answer_key->'analysis'->'author','publishedAt',s.published_at)
  from public.scenarios s join public.scenario_versions v on v.id=s.current_version
  join private.scenario_answer_keys k on k.scenario_version_id=v.id
  join private.scenario_version_players m on m.scenario_version_id=v.id
  join public.players p on p.id=m.player_id
  where s.id=p_scenario_id and s.is_published and (s.is_demo or s.creator_id is not null);
$$;
create function private.catalogue_cursor(p_cursor text,p_kind text,p_filter text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare cur jsonb; date_text text;
begin
  if p_cursor is null then return null; end if;
  cur:=private.decode_creator_cursor(p_cursor);
  if p_kind='players' then
    if not private.creator_object(cur,array['v','kind','query','id']) or cur->'v' is distinct from '1'::jsonb or cur->>'kind' is distinct from 'players'
      or jsonb_typeof(cur->'query')<>'string' or cur->>'query' is distinct from p_filter
      or jsonb_typeof(cur->'id')<>'string' or cur->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then raise invalid_parameter_value; end if;
  elsif p_kind='scenarios' then
    if p_filter is null and private.creator_object(cur,array['publishedAt','id']) then
      if jsonb_typeof(cur->'id')<>'string' or cur->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise invalid_parameter_value; end if;
      if jsonb_typeof(cur->'publishedAt')<>'string' then raise invalid_parameter_value; end if;
      date_text:=cur->>'publishedAt';
    else
      if not private.creator_object(cur,array['v','kind','playerId','at','id']) or cur->'v' is distinct from '1'::jsonb or cur->>'kind' is distinct from 'scenarios'
        or jsonb_typeof(cur->'playerId') not in ('string','null') or cur->>'playerId' is distinct from p_filter or (p_filter is null and cur->'playerId'<>'null'::jsonb)
        or not private.is_catalogue_scenario_id(cur->>'id') or jsonb_typeof(cur->'id')<>'string'
        then raise invalid_parameter_value; end if;
      if jsonb_typeof(cur->'at')<>'string' then raise invalid_parameter_value; end if;
      date_text:=cur->>'at';
    end if;
    if date_text is null or length(date_text)>50 or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise invalid_parameter_value; end if;
    perform date_text::timestamptz;
  else raise invalid_parameter_value; end if;
  return cur;
exception when others then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;

create or replace function public.get_library_preview(p_scenario_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_catalogue_scenario_id(p_scenario_id) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  result:=private.library_preview(p_scenario_id);
  if result is null then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
  return result;
end $$;
drop function public.list_library_previews(text,integer);
create function public.list_library_previews(p_cursor text default null,p_limit integer default 20,p_player_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cur jsonb; cursor_at timestamptz; cursor_id text; rows jsonb; more boolean; next_at timestamptz; next_id text;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  cur:=private.catalogue_cursor(p_cursor,'scenarios',p_player_id::text);
  cursor_at:=coalesce(cur->>'at',cur->>'publishedAt')::timestamptz; cursor_id:=cur->>'id';
  with page as (
    select s.id,coalesce(s.first_published_at,s.created_at) ordered_at,
      row_number() over(order by coalesce(s.first_published_at,s.created_at) desc,s.id desc) n
    from public.scenarios s join private.scenario_version_players m on m.scenario_version_id=s.current_version
    join private.scenario_answer_keys k on k.scenario_version_id=s.current_version
    where s.is_published and (s.is_demo or s.creator_id is not null) and (p_player_id is null or m.player_id=p_player_id)
      and (p_cursor is null or (coalesce(s.first_published_at,s.created_at),s.id)<(cursor_at,cursor_id))
    order by coalesce(s.first_published_at,s.created_at) desc,s.id desc limit p_limit+1
  ) select coalesce(jsonb_agg(private.library_preview(id) order by n) filter(where n<=p_limit),'[]'),count(*)>p_limit,
      max(ordered_at) filter(where n=p_limit),max(id) filter(where n=p_limit) into rows,more,next_at,next_id from page;
  return jsonb_build_object('scenarios',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','scenarios','playerId',p_player_id,'at',next_at,'id',next_id)) else null end);
end $$;
create function public.get_library_player(p_player_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',p.id,'displayName',p.display_name) from public.players p
  where p.id=p_player_id and exists(select 1 from private.scenario_version_players m join public.scenarios s on s.current_version=m.scenario_version_id
    join private.scenario_answer_keys k on k.scenario_version_id=s.current_version
    where m.player_id=p.id and s.is_published and (s.is_demo or s.creator_id is not null));
$$;
create function public.list_library_players(p_query text default '',p_cursor text default null,p_limit integer default 12) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare query text; cur jsonb; rows jsonb; more boolean; cursor_key text; next_id text;
begin
  if p_limit is null or p_limit<1 or p_limit>50 or p_query is null or length(p_query)>800 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  query:=case when regexp_replace(normalize(p_query,NFKC),U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+','','g')='' then '' else private.normalize_player_key(p_query) end;
  if length(query)>100 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  cur:=private.catalogue_cursor(p_cursor,'players',query);
  if cur is not null then
    select normalized_key into cursor_key from public.players where id=(cur->>'id')::uuid;
    if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  end if;
  with visible as (
    select s.id,s.current_version,coalesce(s.first_published_at,s.created_at) ordered_at,m.player_id
    from public.scenarios s join private.scenario_version_players m on m.scenario_version_id=s.current_version
    join private.scenario_answer_keys k on k.scenario_version_id=s.current_version
    where s.is_published and (s.is_demo or s.creator_id is not null)
  ), page as (
    select p.*,row_number() over(order by p.normalized_key collate "C",p.id) n,
      (select count(*) from visible v where v.player_id=p.id) scenario_count
    from public.players p
    where exists(select 1 from visible v where v.player_id=p.id)
      and (query='' or position(query in p.normalized_key)>0 or exists(select 1 from private.player_aliases a where a.player_id=p.id and position(query in a.normalized_key)>0))
      and (p_cursor is null or (p.normalized_key collate "C",p.id)>(cursor_key collate "C",(cur->>'id')::uuid))
    order by p.normalized_key collate "C",p.id limit p_limit+1
  ) select coalesce(jsonb_agg(jsonb_build_object('player',jsonb_build_object('id',p.id,'displayName',p.display_name),'scenarioCount',p.scenario_count,
      'scenarios',(select jsonb_agg(private.library_preview(x.id) order by x.ordered_at desc,x.id desc)
        from (select v.id,v.ordered_at from visible v where v.player_id=p.id order by v.ordered_at desc,v.id desc limit 3) x)) order by n) filter(where n<=p_limit),'[]'),
      count(*)>p_limit,max(id::text) filter(where n=p_limit)
    into rows,more,next_id from page p;
  return jsonb_build_object('players',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','players','query',query,'id',next_id)) else null end);
end $$;
create function public.get_active_training_session() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user(); session_id uuid;
begin
  select id into session_id from public.training_sessions where user_id=actor and phase<>'completed';
  if session_id is null then return null; end if;
  return private.session_summary(session_id);
end $$;

-- Keep idempotency, locks, existing demo targets and immutable session pins unchanged.
create or replace function private.start_target_session(p_request_id uuid,p_target jsonb,p_legacy boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare actor uuid:=private.require_verified_user(); s public.training_sessions; scenario public.scenarios; replay jsonb; created boolean:=false;
  payload jsonb; operation text; count_items integer; target_kind text; target_id text;
begin
  if p_request_id is null or p_legacy is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  target_kind:=p_target->>'kind';
  if target_kind='demo' and private.creator_object(p_target,array['kind']) then target_id:=null;
  elsif target_kind='scenario' and private.creator_object(p_target,array['kind','scenarioId']) and jsonb_typeof(p_target->'scenarioId')='string' and private.is_catalogue_scenario_id(p_target->>'scenarioId') then target_id:=p_target->>'scenarioId';
  else raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  operation:=case when p_legacy then 'start' else 'selected-start' end;
  payload:=case when p_legacy then '{}'::jsonb else jsonb_build_object('target',p_target) end;
  -- Same actor lock as answer/advance; scenario lock is always acquired second.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,0));
  replay:=private.match_session_command(actor,p_request_id,operation,payload); if replay is not null then return replay; end if;
  select * into s from public.training_sessions where user_id=actor and phase<>'completed' for update;
  if found then
    if s.target_kind<>target_kind or s.target_scenario_id is distinct from target_id then
      raise exception using errcode='P0001',message='ACTIVE_SESSION_EXISTS',detail=jsonb_build_object('activeSession',private.session_summary(s.id))::text;
    end if;
  else
    if target_kind='scenario' then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scenario:'||target_id,2));
      select * into scenario from public.scenarios where id=target_id and is_published and (is_demo or creator_id is not null) and current_version is not null;
      if not found then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
      insert into public.training_sessions(user_id,target_kind,target_scenario_id,target_title) values(actor,'scenario',target_id,scenario.title) returning * into s;
      insert into public.training_session_items(session_id,user_id,position,scenario_version_id) values(s.id,actor,0,scenario.current_version);
    else
      insert into public.training_sessions(user_id,target_kind,target_title) values(actor,'demo','Three-scenario demo') returning * into s;
      insert into public.training_session_items(session_id,user_id,position,scenario_version_id)
        select s.id,actor,(row_number() over(order by x.sort_order,x.id)-1)::integer,x.current_version from public.scenarios x where x.is_published and x.is_demo and x.current_version is not null;
      get diagnostics count_items=row_count;
      if count_items=0 then raise exception using errcode='P0001',message='STORAGE_UNAVAILABLE'; end if;
    end if;
    created:=true;
  end if;
  insert into private.session_commands(user_id,request_id,operation,payload,payload_fingerprint,session_id,resulting_revision,created_session)
    values(actor,p_request_id,operation,payload,md5(payload::text),s.id,s.revision,created);
  return jsonb_build_object('session',private.read_session_snapshot(s.id),'created',created,'replayed',false);
end $$;

-- A dedicated trigger role can only add identities/mappings, never read private answers.
do $$ declare fn record; owner_name text; begin
  for fn in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname=any(array['normalize_player_display_name','normalize_player_key','resolve_player','map_scenario_version_player','reject_player_mapping_change','is_catalogue_scenario_id','catalogue_cursor']))
      or (n.nspname='public' and p.proname=any(array['get_library_preview','list_library_previews','get_library_player','list_library_players','get_active_training_session']))
  loop
    owner_name:=case when fn.proname=any(array['normalize_player_display_name','normalize_player_key','resolve_player','map_scenario_version_player','reject_player_mapping_change']) then 'wyp_player_registry' else 'wyp_rpc' end;
    execute format('alter function %s owner to %I',fn.signature,owner_name);
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    if fn.nspname='public' then
      execute format('grant execute on function %s to authenticated',fn.signature);
      if fn.proname<>'get_active_training_session' then execute format('grant execute on function %s to anon',fn.signature); end if;
    end if;
  end loop;
end $$;
grant execute on function private.normalize_player_display_name(text),private.normalize_player_key(text) to wyp_rpc;
revoke create on schema public,private from wyp_player_registry,wyp_rpc;

commit;
