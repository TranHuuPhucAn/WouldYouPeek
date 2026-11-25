begin;
-- Preserve existing sessions and receipts; early closure is a distinct terminal state.
alter table public.training_sessions add column ended_at timestamptz;
alter table public.training_sessions drop constraint training_sessions_phase_check;
alter table public.training_sessions add constraint training_sessions_phase_check check (phase in ('setup','review','completed','ended'));
alter table public.training_sessions drop constraint phase_checkpoint;
alter table public.training_sessions add constraint phase_checkpoint check (
 (phase in ('setup','review') and current_index is not null and current_index >= 0 and completed_at is null and ended_at is null)
 or (phase='completed' and current_index is null and completed_at is not null and ended_at is null)
 or (phase='ended' and current_index is null and completed_at is null and ended_at is not null and ended_at=updated_at and ended_at>=created_at)
);
drop index public.one_active_session_per_user;
create unique index one_active_session_per_user on public.training_sessions(user_id) where phase in ('setup','review');
alter table private.session_commands drop constraint session_commands_operation_check;
alter table private.session_commands add constraint session_commands_operation_check check (operation in ('start','selected-start','playlist-start','answer','advance','end'));
grant update (ended_at) on public.training_sessions to wyp_rpc;
grant create on schema public,private to wyp_rpc;


create or replace function private.read_session_snapshot(p_session_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s public.training_sessions;items jsonb;begin
 select * into s from public.training_sessions where id=p_session_id and user_id=private.current_user_id();if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'position',i.position,'challenge',v.challenge,'answer',case when a.id is null then null else jsonb_build_object('id',a.id,'answeredAt',a.answered_at,'result',a.answer) end) order by i.position),'[]'::jsonb) into items
 from public.training_session_items i join public.scenario_versions v on v.id=i.scenario_version_id left join public.attempts a on a.item_id=i.id and a.user_id=private.current_user_id() where i.session_id=p_session_id and i.user_id=private.current_user_id();
 return jsonb_build_object('id',s.id,'status',case when s.phase in ('completed','ended') then s.phase else 'in_progress' end,'phase',s.phase,'revision',s.revision,'currentIndex',s.current_index,'createdAt',s.created_at,'updatedAt',s.updated_at,'completedAt',s.completed_at,'endedAt',s.ended_at,'items',items,'target',private.session_target(s.target_kind,s.target_scenario_id,s.target_playlist_id),'title',s.target_title)
 ||case when s.target_kind='playlist' then jsonb_build_object('playlist',s.target_playlist_metadata) else '{}'::jsonb end;
end $$;

create or replace function private.session_summary(p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',s.id,'status',case when s.phase in ('completed','ended') then s.phase else 'in_progress' end,
 'answeredCount',(select count(*) from public.attempts a where a.session_id=s.id and a.user_id=private.current_user_id()),'totalCount',(select count(*) from public.training_session_items i where i.session_id=s.id and i.user_id=private.current_user_id()),
 'createdAt',s.created_at,'updatedAt',s.updated_at,'completedAt',s.completed_at,'endedAt',s.ended_at,'target',private.session_target(s.target_kind,s.target_scenario_id,s.target_playlist_id),'title',s.target_title)
 ||case when s.target_kind='playlist' then jsonb_build_object('playlist',s.target_playlist_metadata) else '{}'::jsonb end
 from public.training_sessions s where id=p_session_id and user_id=private.current_user_id();
$$;

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
  select * into s from public.training_sessions where user_id=actor and phase in ('setup','review') for update;
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

create or replace function private.start_playlist_session(p_request_id uuid,p_playlist_id uuid,p_expected_publication_version uuid) returns jsonb language plpgsql set search_path='' as $$
declare actor uuid:=private.require_verified_user();s public.training_sessions;p public.playlists;v private.playlist_versions;payload jsonb;replay jsonb;created boolean:=false;begin
 if p_request_id is null or p_playlist_id is null or p_expected_publication_version is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('target',jsonb_build_object('kind','playlist','playlistId',p_playlist_id),'expectedPublicationVersion',p_expected_publication_version);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));replay:=private.match_session_command(actor,p_request_id,'playlist-start',payload);if replay is not null then return replay;end if;
 select * into s from public.training_sessions where user_id=actor and phase in ('setup','review') for update;
 if found then
  if s.target_kind<>'playlist' or s.target_playlist_id is distinct from p_playlist_id then raise exception using errcode='P0001',message='ACTIVE_SESSION_EXISTS',detail=jsonb_build_object('activeSession',private.session_summary(s.id))::text;end if;
 else
  perform pg_advisory_xact_lock(hashtextextended('playlist:'||p_playlist_id::text,7));
  select * into p from public.playlists where id=p_playlist_id and is_published;
  if not found then raise exception using errcode='P0001',message='PLAYLIST_UNAVAILABLE';end if;
  select * into strict v from private.playlist_versions where id=p.current_version;
  perform private.lock_playlist_scenarios(v.content);
  if not private.playlist_publication_available(v.id) then raise exception using errcode='P0001',message='PLAYLIST_UNAVAILABLE';end if;
  if p.current_version is distinct from p_expected_publication_version then raise exception using errcode='P0001',message='PLAYLIST_CHANGED';end if;
  insert into public.training_sessions(user_id,target_kind,target_title,target_playlist_id,target_playlist_version_id,target_playlist_metadata)
  values(actor,'playlist',v.title,p.id,v.id,jsonb_build_object('publicationVersion',v.id,'credit',v.credit,'players',v.players)) returning * into s;
  insert into public.training_session_items(session_id,user_id,position,scenario_version_id) select s.id,actor,i.position,i.scenario_version_id from private.playlist_version_items i where i.publication_id=v.id order by i.position;
  created:=true;
 end if;
 insert into private.session_commands(user_id,request_id,operation,payload,payload_fingerprint,session_id,resulting_revision,created_session) values(actor,p_request_id,'playlist-start',payload,md5(payload::text),s.id,s.revision,created);
 return jsonb_build_object('session',private.read_session_snapshot(s.id),'created',created,'replayed',false);
end $$;

create or replace function public.get_active_training_session() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user(); session_id uuid;
begin
  select id into session_id from public.training_sessions where user_id=actor and phase in ('setup','review');
  if session_id is null then return null; end if;
  return private.session_summary(session_id);
end $$;

-- Enforce terminal integrity even for trusted maintenance writes.
create function private.validate_session_end() returns trigger
language plpgsql set search_path='' as $$
declare total integer; answered integer; expected integer; prefix_ok boolean; last_answer timestamptz;
begin
 if old.phase='ended' and new is distinct from old then
  raise exception using errcode='P0001',message='IMMUTABLE_RECORD';
 end if;
 if new.phase<>'ended' or old.phase='ended' then return new; end if;
 if old.phase not in ('setup','review') or new.revision<>old.revision+1 then
  raise exception using errcode='P0001',message='SESSION_CONFLICT';
 end if;
 expected:=old.current_index+(case when old.phase='review' then 1 else 0 end);
 select count(*)::integer,count(a.id)::integer,
   coalesce(bool_and((a.id is not null)=(i.position<expected)),false),max(a.answered_at)
 into total,answered,prefix_ok,last_answer
 from public.training_session_items i left join public.attempts a on a.item_id=i.id and a.user_id=new.user_id
 where i.session_id=new.id and i.user_id=new.user_id;
 if total<1 or answered>=total or answered<>expected or not prefix_ok
   or old.revision<>2*old.current_index+(case when old.phase='review' then 1 else 0 end)
   or new.ended_at is null or new.ended_at<old.updated_at
   or (last_answer is not null and new.ended_at<last_answer) then
  raise exception using errcode='P0001',message='SESSION_CONFLICT';
 end if;
 return new;
end $$;
alter function private.validate_session_end() owner to wyp_rpc;
revoke all on function private.validate_session_end() from public,anon,authenticated;
create trigger valid_session_end before update on public.training_sessions
 for each row execute function private.validate_session_end();

create function public.end_training_session(p_session_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user(); s public.training_sessions; payload jsonb; replay jsonb;
 total integer; answered integer;
begin
 if p_session_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 then
  raise exception using errcode='P0001',message='INVALID_REQUEST';
 end if;
 payload:=jsonb_build_object('sessionId',p_session_id,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 replay:=private.match_session_command(actor,p_request_id,'end',payload);
 if replay is not null then return replay; end if;
 select * into s from public.training_sessions where id=p_session_id and user_id=actor for update;
 if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
 if s.revision<>p_expected_revision or s.phase not in ('setup','review') then
  raise exception using errcode='P0001',message='SESSION_CONFLICT';
 end if;
 select count(*)::integer,count(a.id)::integer into total,answered
 from public.training_session_items i left join public.attempts a on a.item_id=i.id and a.user_id=actor
 where i.session_id=s.id and i.user_id=actor;
 if total<1 or answered>=total then raise exception using errcode='P0001',message='SESSION_CONFLICT'; end if;
 update public.training_sessions set phase='ended',current_index=null,ended_at=now(),updated_at=now(),revision=revision+1 where id=s.id;
 insert into private.session_commands(user_id,request_id,operation,payload,payload_fingerprint,session_id,resulting_revision)
 values(actor,p_request_id,'end',payload,md5(payload::text),s.id,s.revision+1);
 return jsonb_build_object('session',private.read_session_snapshot(s.id),'replayed',false);
end $$;
alter function public.end_training_session(uuid,uuid,integer) owner to wyp_rpc;
revoke all on function public.end_training_session(uuid,uuid,integer) from public,anon;
grant execute on function public.end_training_session(uuid,uuid,integer) to authenticated;
revoke create on schema public,private from wyp_rpc;


create or replace function private.video_can_read(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a private.video_assets; actor uuid; begin
 select * into a from private.video_assets where object_path=p_path;
 if not found or a.state='deleted' then return false; end if;
 if private.media_worker_allowed() then return a.state='validating' and a.validation_until>now(); end if;
 actor:=private.require_verified_user();
 if a.owner_id=actor and private.creator_allowed() then return true; end if;
 if a.state<>'ready' then return false; end if;
 return exists(select 1 from private.scenario_version_assets r join public.scenarios s on s.current_version=r.version_id where r.asset_id=a.id and s.is_published and s.creator_id is not null)
 or exists(
  select 1 from private.scenario_version_assets r
  join public.training_session_items i on i.scenario_version_id=r.version_id
  join public.training_sessions s on s.id=i.session_id and s.user_id=i.user_id
  where r.asset_id=a.id and i.user_id=actor and (
   exists(select 1 from public.attempts answer where answer.item_id=i.id and answer.user_id=actor)
   or (s.phase in ('setup','review') and s.current_index=i.position)
  )
 );
exception when others then return false;
end $$;

commit;
