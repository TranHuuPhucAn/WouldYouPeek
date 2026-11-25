begin;
-- Runtime moderation is distinct from creator enrollment and cannot grant access.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='wyp_moderation_rpc') then
  create role wyp_moderation_rpc nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 elsif exists(select 1 from pg_roles where rolname='wyp_moderation_rpc' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then raise exception 'Unsafe moderation role'; end if;
end $$;
grant wyp_moderation_rpc to postgres with set true;
grant usage,create on schema public,private to wyp_moderation_rpc;
grant execute on function private.current_user_id(),private.require_verified_user(),private.creator_object(jsonb,text[]),private.is_catalogue_scenario_id(text),private.encode_creator_cursor(jsonb),private.decode_creator_cursor(text) to wyp_moderation_rpc;
create table private.operator_memberships(
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_at timestamptz not null default now(),revoked_at timestamptz,
 check(revoked_at is null or revoked_at>=granted_at)
);
create table private.scenario_reports(
 id uuid primary key default gen_random_uuid(),reporter_id uuid not null references auth.users(id) on delete cascade,
 scenario_id text not null,scenario_version_id uuid not null,
 category text not null check(category in('broken_video','spoiler','incorrect_context','analysis_issue','inappropriate_content','other')),
 detail text not null check(length(detail)<=2000 and (category<>'other' or btrim(detail)<>'')),
 status text not null default 'open' check(status in('open','resolved')),
 revision integer not null default 0,created_at timestamptz not null default now(),resolved_at timestamptz,
 resolution text,operator_note text,
 foreign key(scenario_version_id,scenario_id) references public.scenario_versions(id,scenario_id),
 check((status='open' and revision=0 and resolved_at is null and resolution is null and operator_note is null)
 or(status='resolved' and revision=1 and resolved_at is not null and operator_note is not null and resolution is not null and resolved_at>=created_at and resolution in('dismissed','addressed') and length(btrim(operator_note)) between 1 and 2000))
);
create unique index one_open_scenario_report on private.scenario_reports(reporter_id,scenario_version_id,category) where status='open';
create index reports_by_actor_time on private.scenario_reports(reporter_id,created_at);
create index reports_queue on private.scenario_reports(status,created_at desc,id desc);
create table private.scenario_visibility(
 scenario_id text primary key references public.scenarios(id),hidden boolean not null,
 revision integer not null check(revision>0),reason text not null check(length(btrim(reason)) between 1 and 1000),
 changed_at timestamptz not null default now(),changed_by uuid not null
);
create table private.moderation_commands(
 actor_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,
 operation text not null check(operation in('report','resolve','visibility')),payload jsonb not null,fingerprint text not null,
 report_id uuid references private.scenario_reports(id) on delete cascade,scenario_id text references public.scenarios(id),
 resulting_revision integer not null check(resulting_revision>=0),duplicate boolean not null default false,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
-- Audit identifiers are deliberately retained without mutable account/report FKs.
create table private.moderation_events(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,request_id uuid not null,
 action text not null check(action in('resolve','hide','restore')),target_id text not null,
 before_state jsonb not null,after_state jsonb not null,reason text not null,
 created_at timestamptz not null default now(),unique(actor_id,request_id)
);
do $$ declare t text;begin
 foreach t in array array['operator_memberships','scenario_reports','scenario_visibility','moderation_commands','moderation_events'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('grant select on private.%I to wyp_moderation_rpc',t);
  execute format('create policy moderation_read on private.%I for select to wyp_moderation_rpc using(true)',t);
 end loop;
 foreach t in array array['scenario_reports','scenario_visibility','moderation_commands','moderation_events'] loop
  execute format('grant insert on private.%I to wyp_moderation_rpc',t);
  execute format('create policy moderation_insert on private.%I for insert to wyp_moderation_rpc with check(true)',t);
 end loop;
end $$;
grant update(status,revision,resolved_at,resolution,operator_note) on private.scenario_reports to wyp_moderation_rpc;
grant update(hidden,revision,reason,changed_at,changed_by) on private.scenario_visibility to wyp_moderation_rpc;
create policy moderation_update on private.scenario_reports for update to wyp_moderation_rpc using(true) with check(true);
create policy moderation_update on private.scenario_visibility for update to wyp_moderation_rpc using(true) with check(true);
create trigger immutable_moderation_command before update on private.moderation_commands for each row execute function private.reject_immutable_change();
create trigger immutable_moderation_event before update or delete on private.moderation_events for each row execute function private.reject_immutable_change();
grant select on public.profiles,public.scenarios,public.scenario_versions,public.training_sessions,public.training_session_items,public.attempts,public.playlists,private.scenario_answer_keys,private.playlist_version_items,private.scenario_version_assets to wyp_moderation_rpc;
create policy moderation_identity_read on public.profiles for select to wyp_moderation_rpc using(user_id=private.current_user_id());
create policy moderation_scenario_read on public.scenarios for select to wyp_moderation_rpc using(true);
create policy moderation_version_read on public.scenario_versions for select to wyp_moderation_rpc using(true);
create policy moderation_key_read on private.scenario_answer_keys for select to wyp_moderation_rpc using(true);
create policy moderation_session_read on public.training_sessions for select to wyp_moderation_rpc using(user_id=private.current_user_id());
create policy moderation_item_read on public.training_session_items for select to wyp_moderation_rpc using(user_id=private.current_user_id());
create policy moderation_attempt_read on public.attempts for select to wyp_moderation_rpc using(user_id=private.current_user_id());
create policy moderation_playlist_read on public.playlists for select to wyp_moderation_rpc using(true);
create policy moderation_playlist_item_read on private.playlist_version_items for select to wyp_moderation_rpc using(true);
create policy moderation_version_asset_read on private.scenario_version_assets for select to wyp_moderation_rpc using(true);

create function private.operator_allowed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.operator_memberships where user_id=private.current_user_id() and revoked_at is null);
$$;
create function private.require_operator() returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user();begin
 if not private.operator_allowed() then raise exception using errcode='P0001',message='OPERATOR_REQUIRED';end if;return actor;
end $$;
create function public.get_operator_access() returns boolean language plpgsql stable security definer set search_path='' as $$
begin perform private.require_verified_user();return private.operator_allowed();end $$;
-- Shared/exclusive advisory locking avoids granting UPDATE on membership merely to use FOR SHARE.
create function private.operator_membership_fence() returns trigger language plpgsql set search_path='' as $$
declare actor uuid;begin
 if tg_op='UPDATE' and new.user_id is distinct from old.user_id then raise exception using errcode='P0001',message='IMMUTABLE_RECORD';end if;
 actor:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 perform pg_advisory_xact_lock(hashtextextended('operator:'||actor::text,10));
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger operator_membership_fence before insert or update or delete on private.operator_memberships for each row execute function private.operator_membership_fence();
create function private.lock_operator_access() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user();begin
 perform pg_advisory_xact_lock_shared(hashtextextended('operator:'||actor::text,10));
 return private.require_operator();
end $$;
create function private.scenario_publicly_available(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.scenarios s where s.id=p_id and s.is_published and s.current_version is not null and (s.is_demo or s.creator_id is not null)
 and not exists(select 1 from private.scenario_visibility h where h.scenario_id=s.id and h.hidden));
$$;
create function private.creator_visibility_notice(p_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('hidden',true,'reason',reason,'changedAt',changed_at) from private.scenario_visibility where scenario_id=p_id and hidden),'{"hidden":false,"reason":null,"changedAt":null}'::jsonb);
$$;
create function private.operator_report_json(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'scenarioId',r.scenario_id,'contentVersion',v.content_version,'category',r.category,'detail',r.detail,'status',r.status,'revision',r.revision,'createdAt',r.created_at,'resolvedAt',r.resolved_at,'resolution',r.resolution,'operatorNote',r.operator_note)
 from private.scenario_reports r join public.scenario_versions v on v.id=r.scenario_version_id where r.id=p_id;
$$;
create function private.operator_visibility_json(p_id text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('scenarioId',s.id,'hidden',coalesce(h.hidden,false),'revision',coalesce(h.revision,0),'reason',h.reason,'changedAt',h.changed_at,'creatorPublished',s.is_published,'currentContentVersion',v.content_version,
 'affectedPlaylistCount',(select count(distinct p.id) from public.playlists p join private.playlist_version_items i on i.publication_id=p.current_version where p.is_published and i.scenario_id=s.id),
 'affectedEditorialPlaylistCount',(select count(distinct p.id) from public.playlists p join private.playlist_version_items i on i.publication_id=p.current_version where p.is_published and p.kind='editorial' and i.scenario_id=s.id))
 from public.scenarios s left join private.scenario_visibility h on h.scenario_id=s.id left join public.scenario_versions v on v.id=s.current_version where s.id=p_id;
$$;
create function private.report_receipt(p_id uuid,p_replayed boolean,p_duplicate boolean) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('report',jsonb_build_object('id',id,'status',status,'createdAt',created_at),'replayed',p_replayed,'duplicate',p_duplicate) from private.scenario_reports where id=p_id;
$$;
create function private.match_moderation_command(p_actor uuid,p_request_id uuid,p_operation text,p_payload jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare c private.moderation_commands;begin
 select * into c from private.moderation_commands where actor_id=p_actor and request_id=p_request_id;if not found then return null;end if;
 if c.operation<>p_operation or c.payload<>p_payload or c.fingerprint<>md5(p_payload::text) then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';end if;
 if p_operation='report' then return private.report_receipt(c.report_id,true,c.duplicate);end if;
 if p_operation='resolve' then return jsonb_build_object('report',private.operator_report_json(c.report_id),'replayed',true);end if;
 return jsonb_build_object('visibility',private.operator_visibility_json(c.scenario_id),'replayed',true);
end $$;
create function private.record_moderation_command(p_actor uuid,p_request_id uuid,p_operation text,p_payload jsonb,p_report_id uuid,p_scenario_id text,p_revision integer,p_duplicate boolean default false) returns void language sql set search_path='' as $$
 insert into private.moderation_commands(actor_id,request_id,operation,payload,fingerprint,report_id,scenario_id,resulting_revision,duplicate)
 values(p_actor,p_request_id,p_operation,p_payload,md5(p_payload::text),p_report_id,p_scenario_id,p_revision,p_duplicate);
$$;
create function public.create_scenario_report(p_request_id uuid,p_target jsonb,p_category text,p_detail text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user();payload jsonb;replay jsonb;sid text;vid uuid;cv text;rid uuid;kind text:=p_target->>'kind';detail text;total integer;s public.training_sessions;i public.training_session_items;
begin
 if p_request_id is null or p_target is null or p_category is null or p_category not in('broken_video','spoiler','incorrect_context','analysis_issue','inappropriate_content','other') or p_detail is null or length(p_detail)>2000 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 detail:=regexp_replace(p_detail,'^[[:space:]]+|[[:space:]]+$','','g');
 if p_category='other' and detail='' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 if kind='publication' then
  if not private.creator_object(p_target,array['kind','scenarioId','contentVersion']) or jsonb_typeof(p_target->'scenarioId') is distinct from 'string' or not private.is_catalogue_scenario_id(p_target->>'scenarioId') or jsonb_typeof(p_target->'contentVersion') is distinct from 'string' or length(p_target->>'contentVersion') not between 1 and 80 or (p_target->>'contentVersion') !~ '^[A-Za-z0-9_.-]+$' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 elsif kind='session-item' then
  if not private.creator_object(p_target,array['kind','sessionId','itemId']) or jsonb_typeof(p_target->'sessionId') is distinct from 'string' or jsonb_typeof(p_target->'itemId') is distinct from 'string' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
  perform (p_target->>'sessionId')::uuid,(p_target->>'itemId')::uuid;
 else raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('target',p_target,'category',p_category,'detail',detail);
 perform pg_advisory_xact_lock(hashtextextended('moderation:'||actor::text,9));
 replay:=private.match_moderation_command(actor,p_request_id,'report',payload);if replay is not null then return replay;end if;
 if kind='publication' then
  sid:=p_target->>'scenarioId';perform pg_advisory_xact_lock(hashtextextended('scenario:'||sid,2));
  if not private.scenario_publicly_available(sid) then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE';end if;
  select sc.current_version,v.content_version into vid,cv from public.scenarios sc join public.scenario_versions v on v.id=sc.current_version where sc.id=sid;
  if cv is distinct from p_target->>'contentVersion' then raise exception using errcode='P0001',message='REPORT_TARGET_CHANGED';end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into s from public.training_sessions where id=(p_target->>'sessionId')::uuid and user_id=actor;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND';end if;
  select * into i from public.training_session_items where id=(p_target->>'itemId')::uuid and session_id=s.id and user_id=actor;
  if not found or not(exists(select 1 from public.attempts a where a.item_id=i.id and a.user_id=actor) or(s.phase in('setup','review') and i.position=s.current_index)) then raise exception using errcode='P0001',message='SESSION_NOT_FOUND';end if;
  vid:=i.scenario_version_id;select scenario_id into strict sid from public.scenario_versions where id=vid;
 end if;
 select id into rid from private.scenario_reports where reporter_id=actor and scenario_version_id=vid and category=p_category and status='open';
 if found then
  perform private.record_moderation_command(actor,p_request_id,'report',payload,rid,sid,0,true);return private.report_receipt(rid,false,true);
 end if;
 select count(*) into total from private.scenario_reports where reporter_id=actor and created_at>now()-interval '1 hour';
 if total>=5 then raise exception using errcode='P0001',message='RATE_LIMITED';end if;
 insert into private.scenario_reports(reporter_id,scenario_id,scenario_version_id,category,detail) values(actor,sid,vid,p_category,detail) returning id into rid;
 perform private.record_moderation_command(actor,p_request_id,'report',payload,rid,sid,0,false);return private.report_receipt(rid,false,false);
exception when invalid_text_representation then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;
create function public.list_operator_reports(p_status text default 'open',p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_operator();cur jsonb;dt timestamptz;cid uuid;rows jsonb;more boolean;next_at timestamptz;next_id uuid;begin
 if p_status is null or p_status not in('open','resolved') or p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 if p_cursor is not null then
  cur:=private.decode_creator_cursor(p_cursor);
  if not private.creator_object(cur,array['status','at','id']) or cur->>'status' is distinct from p_status or jsonb_typeof(cur->'at') is distinct from 'string' or length(cur->>'at')>50 or (cur->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' or jsonb_typeof(cur->'id') is distinct from 'string' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
  dt:=(cur->>'at')::timestamptz;cid:=(cur->>'id')::uuid;
 end if;
 with page as(select r.*,row_number() over(order by r.created_at desc,r.id desc) n from private.scenario_reports r where status=p_status and(p_cursor is null or(r.created_at,r.id)<(dt,cid)) order by r.created_at desc,r.id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.operator_report_json(id) order by n) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit,max(created_at) filter(where n=p_limit),(max(id::text) filter(where n=p_limit))::uuid into rows,more,next_at,next_id from page;
 return jsonb_build_object('reports',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('status',p_status,'at',next_at,'id',next_id)) else null end);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;
create function public.get_operator_report(p_report_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_operator();r private.scenario_reports;v public.scenario_versions;k jsonb;media jsonb;begin
 select * into r from private.scenario_reports where id=p_report_id;if not found then raise exception using errcode='P0001',message='REPORT_NOT_FOUND';end if;
 select * into strict v from public.scenario_versions where id=r.scenario_version_id;
 select answer_key into strict k from private.scenario_answer_keys where scenario_version_id=v.id;
 media:=jsonb_build_object('challenge',v.challenge,'reveal',k->'reveal','optionFeedback',k->'optionFeedback','takeaway',k->'takeaway','outcomeText',k->'outcomeText');
 if k?'observedAction' then media:=media||jsonb_build_object('observedAction',k->'observedAction');end if;
 if k?'analysis' then media:=media||jsonb_build_object('analysis',k->'analysis');end if;
 return jsonb_build_object('report',private.operator_report_json(r.id),'media',media,'visibility',private.operator_visibility_json(r.scenario_id));
end $$;
create function public.resolve_scenario_report(p_report_id uuid,p_request_id uuid,p_expected_revision integer,p_resolution text,p_operator_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user();payload jsonb;replay jsonb;r private.scenario_reports;note text;before_state jsonb;begin
 if p_report_id is null or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_resolution is null or p_resolution not in('dismissed','addressed') or p_operator_note is null or length(p_operator_note)>2000 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 note:=regexp_replace(p_operator_note,'^[[:space:]]+|[[:space:]]+$','','g');if note='' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('reportId',p_report_id,'expectedRevision',p_expected_revision,'resolution',p_resolution,'operatorNote',note);
 perform pg_advisory_xact_lock(hashtextextended('moderation:'||actor::text,9));perform private.lock_operator_access();
 replay:=private.match_moderation_command(actor,p_request_id,'resolve',payload);if replay is not null then return replay;end if;
 select * into r from private.scenario_reports where id=p_report_id for update;if not found then raise exception using errcode='P0001',message='REPORT_NOT_FOUND';end if;
 if r.status<>'open' or r.revision<>p_expected_revision then raise exception using errcode='P0001',message='REPORT_CONFLICT';end if;
 before_state:=private.operator_report_json(r.id);
 update private.scenario_reports set status='resolved',revision=revision+1,resolved_at=now(),resolution=p_resolution,operator_note=note where id=r.id;
 perform private.record_moderation_command(actor,p_request_id,'resolve',payload,r.id,r.scenario_id,r.revision+1);
 insert into private.moderation_events(actor_id,request_id,action,target_id,before_state,after_state,reason) values(actor,p_request_id,'resolve',r.id::text,before_state-'detail',private.operator_report_json(r.id)-'detail',note);
 return jsonb_build_object('report',private.operator_report_json(r.id),'replayed',false);
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure sig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname=any(array['operator_allowed','require_operator','operator_membership_fence','lock_operator_access','scenario_publicly_available','creator_visibility_notice','operator_report_json','operator_visibility_json','report_receipt','match_moderation_command','record_moderation_command']))
 or(n.nspname='public' and p.proname=any(array['get_operator_access','create_scenario_report','list_operator_reports','get_operator_report','resolve_scenario_report'])) loop
 execute format('alter function %s owner to wyp_moderation_rpc',f.sig);execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end $$;
grant execute on function private.scenario_publicly_available(text) to wyp_rpc,wyp_creator_rpc,wyp_video_rpc;
grant execute on function private.creator_visibility_notice(text) to wyp_creator_rpc;
grant execute on function private.require_operator() to wyp_video_rpc;
revoke create on schema public,private from wyp_moderation_rpc;
commit;
