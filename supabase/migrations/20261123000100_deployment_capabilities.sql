-- Hosted installations start with YouTube only. Existing records and uploaded
-- bytes are unchanged; the guarded local setup explicitly enables local media.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='wyp_deployment_rpc') then
  create role wyp_deployment_rpc nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 end if;
 if exists(select 1 from pg_roles where rolname='wyp_deployment_rpc' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then raise exception 'Unsafe deployment role'; end if;
end $$;
grant wyp_deployment_rpc to postgres with set true;
grant usage on schema public,private to wyp_deployment_rpc;
grant create on schema public,private to wyp_deployment_rpc;
create table private.deployment_settings (
 singleton boolean primary key default true check(singleton),
 source_mode text not null default 'youtube-only' check(source_mode in ('youtube-only','youtube-and-upload'))
);
alter table private.deployment_settings enable row level security;
alter table private.deployment_settings force row level security;
revoke all on private.deployment_settings from public,anon,authenticated,wyp_media_validator;
grant select on private.deployment_settings to wyp_deployment_rpc;
create policy deployment_settings_read on private.deployment_settings for select to wyp_deployment_rpc using(true);
insert into private.deployment_settings(singleton) values(true);

create function private.uploads_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select source_mode='youtube-and-upload' from private.deployment_settings where singleton),false);
$$;
create function private.require_uploads_enabled() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
 if not private.uploads_enabled() then raise exception using errcode='P0001',message='UPLOADS_DISABLED'; end if;
end $$;
create function public.get_application_capabilities() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare mode text; begin
 select source_mode into mode from private.deployment_settings where singleton;
 if mode is null then raise exception using errcode='P0001',message='STORAGE_UNAVAILABLE'; end if;
 return jsonb_build_object('sourceMode',mode);
end $$;
alter function private.uploads_enabled() owner to wyp_deployment_rpc;
alter function private.require_uploads_enabled() owner to wyp_deployment_rpc;
alter function public.get_application_capabilities() owner to wyp_deployment_rpc;
revoke all on function private.uploads_enabled(),private.require_uploads_enabled(),public.get_application_capabilities() from public,anon,authenticated,wyp_media_validator;
grant execute on function public.get_application_capabilities() to anon,authenticated;
grant execute on function private.uploads_enabled(),private.require_uploads_enabled() to wyp_video_rpc,wyp_creator_rpc;
revoke create on schema public,private from wyp_deployment_rpc;

-- Replacements preserve existing owners, ACLs, locks and idempotency logic.
-- Media admission precedes work and receipt replay, including old reservations.
create or replace function public.create_creator_video(p_request_id uuid,p_file_name text,p_byte_size bigint,p_mime_type text,p_content_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); aid uuid:=gen_random_uuid(); payload jsonb; replay jsonb; used bigint; pending integer; begin
 perform private.require_uploads_enabled();
 if p_request_id is null or p_file_name is null or length(p_file_name) not between 1 and 255 or p_file_name ~ '[[:cntrl:]]' or p_file_name !~* '\.mp4$' or p_byte_size is null or p_byte_size not between 1 and 2147483648 or p_mime_type is distinct from 'video/mp4' or p_content_fingerprint is null or p_content_fingerprint !~ '^[0-9a-f]{64}$' then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 payload:=jsonb_build_object('fileName',p_file_name,'byteSize',p_byte_size,'mimeType',p_mime_type,'contentFingerprint',p_content_fingerprint);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5));
 replay:=private.video_command_replay(actor,p_request_id,'create',payload); if replay is not null then return replay; end if;
 select coalesce(sum(byte_size) filter(where state<>'deleted'),0),count(*) filter(where state in ('pending_upload','uploaded','validating')) into used,pending from private.video_assets where owner_id=actor;
 if used+p_byte_size>10737418240 or pending>=3 then raise exception using errcode='P0001',message='UPLOAD_LIMIT_REACHED'; end if;
 insert into private.video_assets(id,owner_id,object_path,file_name,byte_size,content_fingerprint) values(aid,actor,actor::text||'/'||aid::text||'/source.mp4',p_file_name,p_byte_size,p_content_fingerprint);
 return private.record_video_command(actor,p_request_id,'create',payload,aid);
end $$;

create or replace function public.get_creator_video(p_asset_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin
 perform private.require_uploads_enabled(); perform private.require_creator(); return private.video_snapshot(p_asset_id); end $$;

create or replace function public.get_creator_video_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); aid uuid; begin
 perform private.require_uploads_enabled();
 select asset_id into aid from private.video_asset_commands where actor_id=actor and request_id=p_request_id and operation='create';
 return jsonb_build_object('video',case when aid is null then null else private.video_snapshot(aid) end);
end $$;

create or replace function public.list_creator_videos(p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); cur jsonb; cursor_at timestamptz; cursor_id uuid; result jsonb; more boolean; last_at timestamptz; last_id text; seen timestamptz; begin
 perform private.require_uploads_enabled();
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 if p_cursor is not null then
  begin
   cur:=private.decode_creator_cursor(p_cursor);
   if not private.creator_object(cur,array['createdAt','id']) then raise invalid_parameter_value; end if;
   cursor_at:=(cur->>'createdAt')::timestamptz; cursor_id:=(cur->>'id')::uuid;
   if cursor_at is null or cursor_id is null then raise invalid_parameter_value; end if;
  exception when others then raise exception using errcode='P0001',message='INVALID_REQUEST'; end;
 end if;
 with page as (select a.*,row_number() over(order by created_at desc,id desc) n from private.video_assets a where owner_id=actor and state<>'deleted' and (p_cursor is null or (created_at,id)<(cursor_at,cursor_id)) order by created_at desc,id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.video_snapshot(id) order by n) filter(where n<=p_limit),'[]'),count(*)>p_limit,max(created_at) filter(where n=p_limit),max(id::text) filter(where n=p_limit) into result,more,last_at,last_id from page;
 select last_seen_at into seen from private.media_validator_status where singleton;
 return jsonb_build_object('videos',result,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('createdAt',last_at,'id',last_id)) else null end,
 'limits',jsonb_build_object('maxFileBytes',2147483648::bigint,'maxDurationSeconds',7200,'maxWidth',1920,'maxHeight',1080,'maxPendingUploads',3,'maxOwnerBytes',10737418240::bigint),
 'validator',jsonb_build_object('online',coalesce(seen>now()-interval '90 seconds',false),'lastSeenAt',seen));
end $$;

create or replace function public.get_creator_video_upload_session(p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; fence uuid; begin
 perform private.require_uploads_enabled();
 perform private.require_creator(); a:=private.lock_owned_video(p_asset_id);
 if a.state<>'pending_upload' then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 if a.upload_expires_at<=now() then raise exception using errcode='P0001',message='UPLOAD_EXPIRED'; end if;
 if a.upload_url is not null then return jsonb_build_object('video',private.video_snapshot(a.id),'upload',private.video_upload_descriptor(a.id),'initializationFence',null); end if;
 if a.upload_init_until>now() then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 fence:=gen_random_uuid(); update private.video_assets set upload_init_fence=fence,upload_init_until=now()+interval '30 seconds' where id=a.id;
 return jsonb_build_object('video',private.video_snapshot(a.id),'upload',private.video_upload_descriptor(a.id),'initializationFence',fence);
end $$;

create or replace function public.finish_creator_video_upload_session(p_asset_id uuid,p_fence uuid,p_upload_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; begin
 perform private.require_uploads_enabled();
 perform private.require_creator(); a:=private.lock_owned_video(p_asset_id);
 if a.state<>'pending_upload' or a.upload_init_fence is distinct from p_fence or p_fence is null or a.upload_init_until<=now() then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 if p_upload_url is null or length(p_upload_url)>2048 or p_upload_url !~ '^https?://[^/?#]+/storage/v1/upload/resumable/[^?#]+$' then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 update private.video_assets set upload_url=p_upload_url,upload_init_fence=null,upload_init_until=null where id=a.id;
 return jsonb_build_object('video',private.video_snapshot(a.id),'upload',private.video_upload_descriptor(a.id));
end $$;

create or replace function public.release_creator_video_upload_session(p_asset_id uuid,p_fence uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 perform private.require_uploads_enabled();
 perform private.require_creator(); update private.video_assets set upload_init_fence=null,upload_init_until=null where id=p_asset_id and owner_id=private.current_user_id() and upload_init_fence=p_fence and state='pending_upload'; return found;
end $$;

create or replace function public.complete_creator_video_upload(p_asset_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; o storage.objects; payload jsonb:=jsonb_build_object('assetId',p_asset_id,'expectedRevision',p_expected_revision); replay jsonb; size bigint; begin
 perform private.require_uploads_enabled();
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5)); replay:=private.video_command_replay(actor,p_request_id,'complete',payload); if replay is not null then return replay; end if;
 a:=private.lock_owned_video(p_asset_id,p_expected_revision);
 if a.state<>'pending_upload' then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 select * into o from storage.objects where bucket_id=a.bucket and name=a.object_path;
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
 begin size:=(o.metadata->>'size')::bigint; exception when others then raise exception using errcode='P0001',message='VIDEO_UNSUPPORTED'; end;
 if size is distinct from a.byte_size then raise exception using errcode='P0001',message='VIDEO_UNSUPPORTED'; end if;
 update private.video_assets set state='uploaded',actual_byte_size=size,object_version=o.id::text||':'||coalesce(o.version,''),revision=revision+1,updated_at=now() where id=a.id;
 return private.record_video_command(actor,p_request_id,'complete',payload,a.id);
end $$;

create or replace function public.retry_creator_video_validation(p_asset_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; payload jsonb:=jsonb_build_object('assetId',p_asset_id,'expectedRevision',p_expected_revision); replay jsonb; begin
 perform private.require_uploads_enabled();
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5)); replay:=private.video_command_replay(actor,p_request_id,'retry',payload); if replay is not null then return replay; end if;
 a:=private.lock_owned_video(p_asset_id,p_expected_revision);
 if a.state<>'rejected' or not a.retryable or a.validation_attempts>=3 then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 update private.video_assets set state='uploaded',failure_code=null,retryable=false,revision=revision+1,updated_at=now() where id=a.id;
 return private.record_video_command(actor,p_request_id,'retry',payload,a.id);
end $$;

create or replace function public.begin_creator_video_delete(p_asset_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; payload jsonb:=jsonb_build_object('assetId',p_asset_id,'expectedRevision',p_expected_revision); replay jsonb; begin
 perform private.require_uploads_enabled();
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5)); replay:=private.video_command_replay(actor,p_request_id,'delete',payload);
 if replay is not null then
  select * into a from private.video_assets where id=p_asset_id and owner_id=actor;
  return replay||jsonb_build_object('object',jsonb_build_object('bucket',a.bucket,'objectPath',a.object_path));
 end if;
 a:=private.lock_owned_video(p_asset_id,p_expected_revision);
 if private.video_is_referenced(a.id) then raise exception using errcode='P0001',message='VIDEO_IN_USE'; end if;
 if a.state='deleted' then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 update private.video_assets set state='deleting',revision=revision+1,validation_fence=null,validation_until=null,upload_init_fence=null,upload_init_until=null,updated_at=now() where id=a.id;
 return private.record_video_command(actor,p_request_id,'delete',payload,a.id)||jsonb_build_object('object',jsonb_build_object('bucket',a.bucket,'objectPath',a.object_path));
end $$;

create or replace function public.finish_creator_video_delete(p_asset_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; c private.video_asset_commands; begin
 perform private.require_uploads_enabled();
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5)); a:=private.lock_owned_video(p_asset_id);
 select * into c from private.video_asset_commands where actor_id=actor and request_id=p_request_id and operation='delete' and asset_id=a.id;
 if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 if a.state='deleted' then return jsonb_build_object('video',private.video_snapshot(a.id),'replayed',true); end if;
 if a.state<>'deleting' or private.video_is_referenced(a.id) then raise exception using errcode='P0001',message='VIDEO_IN_USE'; end if;
 if exists(select 1 from storage.objects where bucket_id=a.bucket and name=a.object_path) then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 update private.video_assets set state='deleted',revision=revision+1,upload_url=null,updated_at=now() where id=a.id;
 return jsonb_build_object('video',private.video_snapshot(a.id),'replayed',false);
end $$;

create or replace function public.authorize_video_playback(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user(); aid uuid; a private.video_assets; d private.scenario_drafts; s public.training_sessions; i public.training_session_items; v public.scenario_versions; answered boolean; k text:=p_context->>'kind'; phase text:=p_context->>'phase'; begin
 perform private.require_uploads_enabled();
 if k='creator-asset' then
  perform private.require_creator();
  if not private.creator_object(p_context,array['kind','assetId']) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  aid:=(p_context->>'assetId')::uuid;
  if not exists(select 1 from private.video_assets where id=aid and owner_id=actor) then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 elsif k='creator-scenario' then
  perform private.require_creator();
  if not private.creator_object(p_context,array['kind','scenarioId','revision','phase']) or phase not in ('setup','reveal') or phase is null or jsonb_typeof(p_context->'revision') is distinct from 'number' then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select draft.* into d from private.scenario_drafts draft join public.scenarios sc on sc.id=draft.scenario_id where draft.scenario_id=p_context->>'scenarioId' and sc.creator_id=actor;
  if not found then raise exception using errcode='P0001',message='SCENARIO_NOT_FOUND'; end if;
  if d.revision::numeric<>(p_context->>'revision')::numeric then raise exception using errcode='P0001',message='SCENARIO_CONFLICT'; end if;
  if d.content->'source'->>'kind' is distinct from 'uploaded' then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
  aid:=(d.content->'source'->>'assetId')::uuid;
 elsif k='library-scenario' then
  if not private.creator_object(p_context,array['kind','scenarioId']) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select ver.* into v from public.scenarios sc join public.scenario_versions ver on ver.id=sc.current_version where sc.id=p_context->>'scenarioId' and private.scenario_publicly_available(sc.id) and sc.creator_id is not null;
  if not found then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
  select asset_id into aid from private.scenario_version_assets where version_id=v.id;
 elsif k='operator-report' then
  if not private.creator_object(p_context,array['kind','reportId','phase']) or phase is null or phase not in('setup','reveal') or jsonb_typeof(p_context->'reportId') is distinct from 'string' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
  aid:=private.operator_report_asset((p_context->>'reportId')::uuid);
 elsif k='session-item' then
  if not private.creator_object(p_context,array['kind','sessionId','itemId','phase']) or phase not in ('setup','reveal') or phase is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select * into s from public.training_sessions where id=(p_context->>'sessionId')::uuid and user_id=actor;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
  select * into i from public.training_session_items where id=(p_context->>'itemId')::uuid and session_id=s.id and user_id=actor;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
  answered:=exists(select 1 from public.attempts where item_id=i.id and user_id=actor);
  if not answered and (phase='reveal' or s.phase not in('setup','review') or i.position is distinct from s.current_index) then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
  select asset_id into aid from private.scenario_version_assets where version_id=i.scenario_version_id;
 else raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 select * into a from private.video_assets where id=aid and state='ready';
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
 if not exists(select 1 from storage.objects o where bucket_id=a.bucket and name=a.object_path and o.id::text||':'||coalesce(o.version,'')=a.object_version) then raise exception using errcode='P0001',message='MEDIA_UNAVAILABLE'; end if;
 return jsonb_build_object('assetId',a.id,'bucket',a.bucket,'objectPath',a.object_path);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;

create or replace function private.require_media_worker() returns void
language plpgsql stable security invoker set search_path='' as $$
begin
 perform private.require_uploads_enabled(); if not private.media_worker_allowed() then raise exception using errcode='42501',message='Media validator identity required'; end if; end $$;

create or replace function private.video_can_insert(p_path text,p_metadata jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a private.video_assets; size bigint; begin
 if not private.uploads_enabled() then return false; end if;
 if not private.creator_allowed() then return false; end if;
 -- Keep final Storage insertion serialized against begin-delete until its
 -- transaction commits; otherwise deletion could confirm absence too early.
 select * into a from private.video_assets where object_path=p_path and owner_id=private.current_user_id() and state='pending_upload' and upload_expires_at>now() for share;
 if not found then return false; end if;
 if p_metadata->>'size' is null then return true; end if;
 begin size:=(p_metadata->>'size')::bigint; exception when others then return false; end;
 return size=a.byte_size;
end $$;

create or replace function private.video_can_read(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a private.video_assets; actor uuid; begin
 if not private.uploads_enabled() then return false; end if;
 select * into a from private.video_assets where object_path=p_path;
 if not found or a.state='deleted' then return false; end if;
 if private.media_worker_allowed() then return a.state='validating' and a.validation_until>now(); end if;
 actor:=private.require_verified_user();
 if a.owner_id=actor and private.creator_allowed() then return true; end if;
 if a.state<>'ready' then return false; end if;
 return exists(select 1 from private.scenario_version_assets r join public.scenarios s on s.current_version=r.version_id where r.asset_id=a.id and private.scenario_publicly_available(s.id) and s.creator_id is not null)
 or private.operator_report_asset_allowed(a.id)
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

create or replace function private.video_can_delete(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a private.video_assets; begin
 if not private.uploads_enabled() then return false; end if;
 if not private.creator_allowed() then return false; end if;
 select * into a from private.video_assets where object_path=p_path and owner_id=private.current_user_id() and state='deleting';
 return found and not private.video_is_referenced(a.id);
end $$;

create or replace function private.assert_creator_video_source(p_content jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; aid uuid; stop numeric; begin
 if p_content->'source'->>'kind'='uploaded' then perform private.require_uploads_enabled(); end if;
 if p_content->'source'->>'kind' is distinct from 'uploaded' or p_content->'source'->'assetId'='null'::jsonb then return; end if;
 aid:=(p_content->'source'->>'assetId')::uuid;
 select * into a from private.video_assets where id=aid and owner_id=private.current_user_id() for update;
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 if a.state<>'ready' or not exists(select 1 from storage.objects o where o.bucket_id=a.bucket and o.name=a.object_path and o.id::text||':'||coalesce(o.version,'')=a.object_version and (o.metadata->>'size')::bigint=a.byte_size) then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
 stop:=(p_content->'media'->>'endSeconds')::numeric;
 if stop is not null and stop>(a.metadata->>'durationSeconds')::numeric then raise exception using errcode='P0001',message='INVALID_REQUEST',detail='{"issues":[{"path":"media.endSeconds","code":"DURATION","message":"The continuation cannot exceed the uploaded video duration."}]}'; end if;
end $$;

create or replace function private.record_version_video_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare aid uuid; a private.video_assets; begin
 if new.challenge->'source'->>'kind'='uploaded' then perform private.require_uploads_enabled(); end if;
 if new.challenge->'source'->>'kind'='uploaded' then
  aid:=(new.challenge->'source'->>'assetId')::uuid;
  select * into a from private.video_assets where id=aid and owner_id=private.current_user_id() and state='ready' for update;
  if not found then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
  insert into private.scenario_version_assets(version_id,asset_id) values(new.id,aid);
 end if;
 return new;
end $$;

create or replace function public.save_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_content jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; replay jsonb; payload jsonb; issues jsonb; v_content jsonb:=p_content; vid text;
begin
 if p_content->'source'->>'kind'='uploaded' then perform private.require_uploads_enabled(); end if;
  if p_request_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  issues:=private.validate_creator_draft(v_content,false);
  if jsonb_array_length(issues)>0 then raise exception using errcode='P0001',message='INVALID_REQUEST',detail=jsonb_build_object('issues',issues)::text; end if;
  v_content:=private.normalize_creator_content(v_content);
  vid:=private.creator_youtube_id(v_content->'source'->>'url');
  if vid is not null then v_content:=jsonb_set(v_content,'{source,url}',to_jsonb('https://www.youtube.com/watch?v='||vid)); end if;
  payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision,'content',v_content);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'save',payload); if replay is not null then return replay; end if;
  d:=private.lock_creator_draft(p_scenario_id,p_expected_revision);
  update private.scenario_drafts set revision=revision+1,
    draft_revision=draft_revision+case when v_content is distinct from d.content then 1 else 0 end,
    review_id=case when v_content is distinct from d.content then null else review_id end,
    content=v_content,checksum=private.creator_content_checksum(v_content),saved_at=now(),updated_at=now()
  where scenario_id=p_scenario_id;
  update public.scenarios set updated_at=now() where id=p_scenario_id;
  return private.record_creator_command(actor,p_request_id,'save',payload,p_scenario_id);
end $$;

create or replace function public.review_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_checklist jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; replay jsonb; payload jsonb; issues jsonb; v_review_id uuid;
begin
 if not private.uploads_enabled() and exists(select 1 from private.scenario_drafts draft join public.scenarios sc on sc.id=draft.scenario_id where draft.scenario_id=p_scenario_id and sc.creator_id=actor and draft.content->'source'->>'kind'='uploaded') then perform private.require_uploads_enabled(); end if;
  if p_request_id is null or not private.creator_object(p_checklist,array['povInformationChecked','setupSpoilersChecked','pauseTimingChecked','continuationChecked','normalSpeedAudioChecked','alternativeChoicesChecked','sourceAttributionChecked']) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  if exists(select 1 from jsonb_each(p_checklist) x where x.value is distinct from 'true'::jsonb) then raise exception using errcode='P0001',message='REVIEW_REQUIRED'; end if;
  payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision,'checklist',p_checklist);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'review',payload); if replay is not null then return replay; end if;
  d:=private.lock_creator_draft(p_scenario_id,p_expected_revision);
  issues:=private.validate_creator_draft(d.content,true);
  if jsonb_array_length(issues)>0 then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',issues)::text; end if;
  perform private.assert_creator_video_source(d.content);
  insert into private.scenario_reviews(scenario_id,draft_revision,checksum,reviewer_id,checklist)
    values(p_scenario_id,d.draft_revision,d.checksum,actor,p_checklist) returning id into v_review_id;
  update private.scenario_drafts set review_id=v_review_id,revision=revision+1,updated_at=now() where scenario_id=p_scenario_id;
  return private.record_creator_command(actor,p_request_id,'review',payload,p_scenario_id);
end $$;

create or replace function public.publish_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_review_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; r private.scenario_reviews; v public.scenario_versions;
  replay jsonb; payload jsonb; issues jsonb; projected jsonb; version_no integer; version_id uuid; version_name text;
begin
 if not private.uploads_enabled() and exists(select 1 from private.scenario_drafts draft join public.scenarios sc on sc.id=draft.scenario_id where draft.scenario_id=p_scenario_id and sc.creator_id=actor and draft.content->'source'->>'kind'='uploaded') then perform private.require_uploads_enabled(); end if;
  if p_request_id is null or p_review_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision,'reviewId',p_review_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'publish',payload); if replay is not null then return replay; end if;
  d:=private.lock_creator_draft(p_scenario_id,p_expected_revision);
  select * into r from private.scenario_reviews where id=p_review_id and id=d.review_id and scenario_id=p_scenario_id and reviewer_id=actor and draft_revision=d.draft_revision and checksum=d.checksum;
  if not found then raise exception using errcode='P0001',message='REVIEW_REQUIRED'; end if;
  issues:=private.validate_creator_draft(d.content,true);
  if jsonb_array_length(issues)>0 then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',issues)::text; end if;
  perform private.assert_creator_video_source(d.content);
  -- Digest matches are additionally compared against complete immutable projections.
  for v in select * from public.scenario_versions where scenario_id=p_scenario_id and checksum=d.checksum order by created_at desc loop
    projected:=private.project_creator_publication(p_scenario_id,v.content_version,d.content);
    if v.challenge=projected->'challenge' and exists(select 1 from private.scenario_answer_keys where scenario_version_id=v.id and answer_key=projected->'answerKey') then version_id:=v.id; version_name:=v.content_version; exit; end if;
  end loop;
  if version_id is null then
    select count(*)::integer+1 into version_no from public.scenario_versions where scenario_id=p_scenario_id;
    version_name:='creator-'||version_no; version_id:=gen_random_uuid();
    projected:=private.project_creator_publication(p_scenario_id,version_name,d.content);
    insert into public.scenario_versions(id,scenario_id,content_version,challenge,checksum) values(version_id,p_scenario_id,version_name,projected->'challenge',d.checksum);
    insert into private.scenario_answer_keys(scenario_version_id,answer_key,review) values(version_id,projected->'answerKey',jsonb_build_object('reviewedBy','creator','reviewId',r.id,'reviewerId',r.reviewer_id,'reviewedAt',r.reviewed_at,'draftRevision',r.draft_revision,'checksum',r.checksum,'checklist',r.checklist));
  end if;
  update public.scenarios set current_version=version_id,is_published=true,title=d.content->>'title',topic=d.content->>'topic',
    first_published_at=coalesce(first_published_at,now()),published_at=now(),updated_at=now() where id=p_scenario_id;
  update private.scenario_drafts set revision=revision+1,updated_at=now() where scenario_id=p_scenario_id;
  return private.record_creator_command(actor,p_request_id,'publish',payload,p_scenario_id,version_name);
end $$;

create or replace function public.get_creator_review_preview(p_scenario_id text,p_revision integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare snapshot jsonb; projected jsonb; content jsonb; version text; answers jsonb;
begin
  perform private.require_creator(); snapshot:=private.read_creator_snapshot(p_scenario_id);
  if snapshot->'draft'->'content'->'source'->>'kind'='uploaded' then perform private.require_uploads_enabled(); end if;
  if p_revision is null or p_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  if (snapshot->>'revision')::integer<>p_revision then raise exception using errcode='P0001',message='SCENARIO_CONFLICT'; end if;
  if not (snapshot->'readiness'->>'canReview')::boolean then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',snapshot->'readiness'->'issues')::text; end if;
  content:=snapshot->'draft'->'content'; version:='draft-'||(snapshot->'draft'->>'revision');
  projected:=private.project_creator_publication(p_scenario_id,version,content);
  select jsonb_object_agg(opt->>'id',projected->'answerKey'||jsonb_build_object('challengeId',p_scenario_id,'contentVersion',version,
    'selectedOptionId',opt->'id','selectedAssessment',opt->'assessment','matchesPro',opt->>'id'=content->'observedAction'->>'optionId'))
    into answers from jsonb_array_elements(content->'options') opt;
  return jsonb_build_object('scenario',snapshot,'challenge',projected->'challenge','feedbackByOption',answers);
end $$;
