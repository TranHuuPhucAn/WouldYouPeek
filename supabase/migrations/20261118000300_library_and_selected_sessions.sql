alter table public.training_sessions
  add column target_kind text not null default 'demo',
  add column target_scenario_id text references public.scenarios(id),
  add column target_title text not null default 'Three-scenario demo',
  add constraint training_target_shape check ((target_kind='demo' and target_scenario_id is null) or (target_kind='scenario' and target_scenario_id is not null));
alter table private.session_commands drop constraint session_commands_operation_check;
alter table private.session_commands add constraint session_commands_operation_check check(operation in ('start','selected-start','answer','advance'));
create function private.session_target(p_kind text,p_scenario_id text) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_kind='demo' then '{"kind":"demo"}'::jsonb else jsonb_build_object('kind','scenario','scenarioId',p_scenario_id) end;
$$;
create function private.reject_session_target_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.target_kind,new.target_scenario_id,new.target_title) is distinct from (old.target_kind,old.target_scenario_id,old.target_title) then
    raise exception using errcode='P0001',message='IMMUTABLE_RECORD';
  end if;
  return new;
end $$;
create trigger immutable_session_target before update on public.training_sessions for each row execute function private.reject_session_target_change();
create or replace function private.read_session_snapshot(p_session_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_session public.training_sessions; v_items jsonb;
begin
  select * into v_session from public.training_sessions where id = p_session_id and user_id = private.current_user_id();
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'position', i.position, 'challenge', v.challenge,
    'answer', case when a.id is null then null else jsonb_build_object('id', a.id, 'answeredAt', a.answered_at, 'result', a.answer) end
  ) order by i.position), '[]'::jsonb) into v_items
  from public.training_session_items i
  join public.scenario_versions v on v.id = i.scenario_version_id
  left join public.attempts a on a.item_id = i.id and a.user_id = private.current_user_id()
  where i.session_id = p_session_id and i.user_id = private.current_user_id();
  return jsonb_build_object(
    'id', v_session.id, 'status', case when v_session.phase = 'completed' then 'completed' else 'in_progress' end,
    'phase', v_session.phase, 'revision', v_session.revision, 'currentIndex', v_session.current_index,
    'createdAt', v_session.created_at, 'updatedAt', v_session.updated_at, 'completedAt', v_session.completed_at,
    'items', v_items, 'target', private.session_target(v_session.target_kind,v_session.target_scenario_id), 'title', v_session.target_title
  );
end;
$$;

create function private.session_summary(p_session_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',s.id,'status',case when s.phase='completed' then 'completed' else 'in_progress' end,
    'answeredCount',(select count(*) from public.attempts a where a.session_id=s.id and a.user_id=private.current_user_id()),
    'totalCount',(select count(*) from public.training_session_items i where i.session_id=s.id and i.user_id=private.current_user_id()),
    'createdAt',s.created_at,'updatedAt',s.updated_at,'completedAt',s.completed_at,'target',private.session_target(s.target_kind,s.target_scenario_id),'title',s.target_title)
  from public.training_sessions s where id=p_session_id and user_id=private.current_user_id();
$$;

create function private.library_preview(p_scenario_id text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.scenario_preview(v.challenge)||jsonb_build_object('provenance',k.answer_key->'analysis'->'author','publishedAt',s.published_at)
  from public.scenarios s join public.scenario_versions v on v.id=s.current_version
  join private.scenario_answer_keys k on k.scenario_version_id=v.id
  where s.id=p_scenario_id and s.is_published and not s.is_demo and s.creator_id is not null;
$$;
create function public.get_library_preview(p_scenario_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_verified_user(); result:=private.library_preview(p_scenario_id);
  if result is null then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
  return result;
end $$;
create function public.list_library_previews(p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cur jsonb; cursor_at timestamptz; cursor_id text; rows jsonb; more boolean; next_at timestamptz; next_id text;
begin
  perform private.require_verified_user();
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  if p_cursor is not null then
    begin
      cur:=private.decode_creator_cursor(p_cursor);
      if not private.creator_object(cur,array['publishedAt','id']) or not private.creator_text(cur->'publishedAt',50) or not private.creator_text(cur->'id',36) or cur->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or cur->>'publishedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise invalid_parameter_value; end if;
      cursor_at:=(cur->>'publishedAt')::timestamptz; cursor_id:=lower(cur->>'id');
    exception when others then raise exception using errcode='P0001',message='INVALID_REQUEST'; end;
  end if;
  with page as (
    select s.*,row_number() over(order by s.first_published_at desc,s.id desc) n from public.scenarios s
    where s.is_published and not s.is_demo and s.creator_id is not null and s.current_version is not null
      and (p_cursor is null or (s.first_published_at,s.id)<(cursor_at,cursor_id))
    order by s.first_published_at desc,s.id desc limit p_limit+1
  ) select coalesce(jsonb_agg(private.library_preview(id) order by n) filter(where n<=p_limit),'[]'),count(*)>p_limit,
      max(first_published_at) filter(where n=p_limit),max(id) filter(where n=p_limit) into rows,more,next_at,next_id from page;
  return jsonb_build_object('scenarios',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('publishedAt',next_at,'id',next_id)) else null end);
end $$;

create function private.start_target_session(p_request_id uuid,p_target jsonb,p_legacy boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare actor uuid:=private.require_verified_user(); s public.training_sessions; scenario public.scenarios; replay jsonb; created boolean:=false;
  payload jsonb; operation text; count_items integer; target_kind text; target_id text;
begin
  if p_request_id is null or p_legacy is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  target_kind:=p_target->>'kind';
  if target_kind='demo' and private.creator_object(p_target,array['kind']) then target_id:=null;
  elsif target_kind='scenario' and private.creator_object(p_target,array['kind','scenarioId']) and private.creator_text(p_target->'scenarioId',36) and p_target->>'scenarioId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then target_id:=p_target->>'scenarioId';
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
      select * into scenario from public.scenarios where id=target_id and is_published and not is_demo and creator_id is not null and current_version is not null;
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
create function public.start_selected_training_session(p_request_id uuid,p_target jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin return private.start_target_session(p_request_id,p_target,false); end $$;
create or replace function public.start_training_session(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin return private.start_target_session(p_request_id,'{"kind":"demo"}',true); end $$;

create or replace function private.match_session_command(p_user_id uuid, p_request_id uuid, p_operation text, p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_command private.session_commands; v_result jsonb;
begin
  select * into v_command from private.session_commands where user_id = p_user_id and request_id = p_request_id;
  if not found then return null; end if;
  -- Compare the complete logical payload as well as its fingerprint; hashes alone are not an authorization boundary.
  if v_command.operation <> p_operation or v_command.payload <> p_payload or v_command.payload_fingerprint <> md5(p_payload::text) then
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT';
  end if;
  v_result := jsonb_build_object('session', private.read_session_snapshot(v_command.session_id), 'replayed', true);
  if p_operation in ('start','selected-start') then v_result := v_result || jsonb_build_object('created', v_command.created_session); end if;
  return v_result;
end;
$$;

create or replace function public.list_training_sessions(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := private.require_verified_user(); v_cursor public.training_sessions; v_rows jsonb; v_more boolean; v_next text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  if p_cursor is not null then
    if p_cursor !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
    end if;
    select * into v_cursor from public.training_sessions where id = p_cursor::uuid and user_id = v_user;
    if not found then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  end if;
  with ordered as (
    select s.*, row_number() over (order by s.created_at desc, s.id desc) as sequence
    from public.training_sessions s where s.user_id = v_user
      and (p_cursor is null or (s.created_at, s.id) < (v_cursor.created_at, v_cursor.id))
    order by s.created_at desc, s.id desc limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'status', case when o.phase = 'completed' then 'completed' else 'in_progress' end,
    'answeredCount', (select count(*) from public.attempts a where a.session_id = o.id and a.user_id = v_user),
    'totalCount', (select count(*) from public.training_session_items i where i.session_id = o.id and i.user_id = v_user),
    'createdAt', o.created_at, 'updatedAt', o.updated_at, 'completedAt', o.completed_at, 'target', private.session_target(o.target_kind,o.target_scenario_id), 'title', o.target_title
  ) order by o.sequence) filter (where o.sequence <= p_limit), '[]'::jsonb),
  count(*) > p_limit, max(o.id::text) filter (where o.sequence = p_limit)
  into v_rows, v_more, v_next from ordered o;
  return jsonb_build_object('sessions', v_rows, 'nextCursor', case when v_more then v_next else null end);
end;
$$;

