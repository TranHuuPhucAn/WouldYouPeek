create function private.read_session_snapshot(p_session_id uuid) returns jsonb
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
    'items', v_items
  );
end;
$$;

create function private.match_session_command(p_user_id uuid, p_request_id uuid, p_operation text, p_payload jsonb) returns jsonb
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
  if p_operation = 'start' then v_result := v_result || jsonb_build_object('created', v_command.created_session); end if;
  return v_result;
end;
$$;

create function public.get_training_session(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_verified_user();
  return private.read_session_snapshot(p_session_id);
end;
$$;

create function public.start_training_session(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_verified_user(); v_session public.training_sessions;
  v_replayed jsonb; v_created boolean := false; v_payload jsonb := '{}'::jsonb; v_count integer;
begin
  if p_request_id is null then raise exception using errcode = 'P0001', message = 'INVALID_REQUEST'; end if;
  -- Every command for one account takes the same transaction lock, including distinct request IDs.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  v_replayed := private.match_session_command(v_user, p_request_id, 'start', v_payload);
  if v_replayed is not null then return v_replayed; end if;
  select * into v_session from public.training_sessions where user_id = v_user and phase <> 'completed' for update;
  if not found then
    insert into public.training_sessions(user_id) values (v_user) returning * into v_session;
    insert into public.training_session_items(session_id, user_id, position, scenario_version_id)
    select v_session.id, v_user, (row_number() over (order by s.sort_order, s.id) - 1)::integer, s.current_version
    from public.scenarios s where s.is_published and s.is_demo and s.current_version is not null;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception using errcode = 'P0001', message = 'STORAGE_UNAVAILABLE'; end if;
    v_created := true;
  end if;
  insert into private.session_commands(user_id, request_id, operation, payload, payload_fingerprint, session_id, resulting_revision, created_session)
  values (v_user, p_request_id, 'start', v_payload, md5(v_payload::text), v_session.id, v_session.revision, v_created);
  return jsonb_build_object('session', private.read_session_snapshot(v_session.id), 'replayed', false, 'created', v_created);
end;
$$;

create function public.submit_session_answer(p_session_id uuid, p_item_id uuid, p_option_id text, p_request_id uuid, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_verified_user(); v_session public.training_sessions;
  v_item public.training_session_items; v_version public.scenario_versions;
  v_key jsonb; v_feedback jsonb; v_result jsonb; v_replayed jsonb; v_payload jsonb;
begin
  if p_session_id is null or p_item_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision < 0
     or p_option_id is null or length(p_option_id) < 1 or length(p_option_id) > 120 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  v_payload := jsonb_build_object('sessionId', p_session_id, 'itemId', p_item_id, 'optionId', p_option_id, 'expectedRevision', p_expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  v_replayed := private.match_session_command(v_user, p_request_id, 'answer', v_payload);
  if v_replayed is not null then return v_replayed; end if;
  select * into v_session from public.training_sessions where id = p_session_id and user_id = v_user for update;
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;
  if v_session.revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'SESSION_CONFLICT'; end if;
  select * into v_item from public.training_session_items where id = p_item_id and session_id = p_session_id and user_id = v_user;
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;
  if exists (select 1 from public.attempts where item_id = p_item_id and user_id = v_user) then
    raise exception using errcode = 'P0001', message = 'ANSWER_LOCKED';
  end if;
  if v_session.phase <> 'setup' or v_session.current_index <> v_item.position then
    raise exception using errcode = 'P0001', message = 'SESSION_CONFLICT';
  end if;
  select * into strict v_version from public.scenario_versions where id = v_item.scenario_version_id;
  if not exists (select 1 from jsonb_array_elements(v_version.challenge->'options') option where option->>'id' = p_option_id) then
    raise exception using errcode = 'P0001', message = 'INVALID_OPTION';
  end if;
  select answer_key into strict v_key from private.scenario_answer_keys where scenario_version_id = v_item.scenario_version_id;
  select feedback into v_feedback from jsonb_array_elements(v_key->'optionFeedback') feedback where feedback->>'optionId' = p_option_id;
  if v_feedback is null then raise exception using errcode = 'P0001', message = 'STORAGE_UNAVAILABLE'; end if;
  v_result := v_key || jsonb_build_object(
    'challengeId', v_version.scenario_id, 'contentVersion', v_version.content_version,
    'selectedOptionId', p_option_id, 'selectedAssessment', v_feedback->>'assessment',
    'matchesPro', (v_key->'observedAction'->>'optionId') = p_option_id
  );
  insert into public.attempts(item_id, session_id, user_id, option_id, answer)
  values (p_item_id, p_session_id, v_user, p_option_id, v_result);
  update public.training_sessions set phase = 'review', revision = revision + 1, updated_at = now() where id = p_session_id;
  insert into private.session_commands(user_id, request_id, operation, payload, payload_fingerprint, session_id, resulting_revision)
  values (v_user, p_request_id, 'answer', v_payload, md5(v_payload::text), p_session_id, v_session.revision + 1);
  return jsonb_build_object('session', private.read_session_snapshot(p_session_id), 'replayed', false);
end;
$$;

create function public.advance_training_session(p_session_id uuid, p_from_item_id uuid, p_request_id uuid, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_verified_user(); v_session public.training_sessions;
  v_item public.training_session_items; v_replayed jsonb; v_payload jsonb; v_last boolean;
begin
  if p_session_id is null or p_from_item_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST';
  end if;
  v_payload := jsonb_build_object('sessionId', p_session_id, 'fromItemId', p_from_item_id, 'expectedRevision', p_expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  v_replayed := private.match_session_command(v_user, p_request_id, 'advance', v_payload);
  if v_replayed is not null then return v_replayed; end if;
  select * into v_session from public.training_sessions where id = p_session_id and user_id = v_user for update;
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;
  if v_session.revision <> p_expected_revision then raise exception using errcode = 'P0001', message = 'SESSION_CONFLICT'; end if;
  select * into v_item from public.training_session_items where id = p_from_item_id and session_id = p_session_id and user_id = v_user;
  if not found then raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND'; end if;
  if v_session.phase <> 'review' or v_session.current_index <> v_item.position
     or not exists (select 1 from public.attempts where item_id = p_from_item_id and user_id = v_user) then
    raise exception using errcode = 'P0001', message = 'SESSION_CONFLICT';
  end if;
  v_last := not exists (select 1 from public.training_session_items where session_id = p_session_id and user_id = v_user and position > v_item.position);
  update public.training_sessions set
    phase = case when v_last then 'completed' else 'setup' end,
    current_index = case when v_last then null else current_index + 1 end,
    completed_at = case when v_last then now() else null end,
    revision = revision + 1, updated_at = now()
  where id = p_session_id;
  insert into private.session_commands(user_id, request_id, operation, payload, payload_fingerprint, session_id, resulting_revision)
  values (v_user, p_request_id, 'advance', v_payload, md5(v_payload::text), p_session_id, v_session.revision + 1);
  return jsonb_build_object('session', private.read_session_snapshot(p_session_id), 'replayed', false);
end;
$$;

create function public.list_training_sessions(p_cursor text default null, p_limit integer default 20) returns jsonb
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
    'createdAt', o.created_at, 'updatedAt', o.updated_at, 'completedAt', o.completed_at
  ) order by o.sequence) filter (where o.sequence <= p_limit), '[]'::jsonb),
  count(*) > p_limit, max(o.id::text) filter (where o.sequence = p_limit)
  into v_rows, v_more, v_next from ordered o;
  return jsonb_build_object('sessions', v_rows, 'nextCursor', case when v_more then v_next else null end);
end;
$$;

alter function private.read_session_snapshot(uuid) owner to wyp_rpc;
alter function private.match_session_command(uuid, uuid, text, jsonb) owner to wyp_rpc;
alter function public.get_training_session(uuid) owner to wyp_rpc;
alter function public.start_training_session(uuid) owner to wyp_rpc;
alter function public.submit_session_answer(uuid, uuid, text, uuid, integer) owner to wyp_rpc;
alter function public.advance_training_session(uuid, uuid, uuid, integer) owner to wyp_rpc;
alter function public.list_training_sessions(text, integer) owner to wyp_rpc;

revoke all on function private.read_session_snapshot(uuid), private.match_session_command(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.get_training_session(uuid), public.start_training_session(uuid), public.submit_session_answer(uuid, uuid, text, uuid, integer), public.advance_training_session(uuid, uuid, uuid, integer), public.list_training_sessions(text, integer) from public, anon, authenticated;
grant execute on function public.get_training_session(uuid), public.start_training_session(uuid), public.submit_session_answer(uuid, uuid, text, uuid, integer), public.advance_training_session(uuid, uuid, uuid, integer), public.list_training_sessions(text, integer) to authenticated;

-- Prevent new functions from silently acquiring PUBLIC execute privileges in later migrations.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;
revoke create on schema public, private from wyp_rpc;
revoke create on schema private from wyp_auth_sync;
