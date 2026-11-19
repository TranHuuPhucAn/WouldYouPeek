-- Private immutable uploads. This migration does not rewrite existing scenarios.
alter default privileges revoke execute on functions from public;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='wyp_video_rpc') then
    create role wyp_video_rpc nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists(select 1 from pg_roles where rolname='wyp_media_validator') then
    create role wyp_media_validator nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if exists(select 1 from pg_roles where rolname in ('wyp_video_rpc','wyp_media_validator') and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then raise exception 'Unsafe media role'; end if;
end $$;
grant wyp_video_rpc,wyp_media_validator to postgres with set true;
grant wyp_media_validator to authenticator;
grant usage on schema public,private,storage to wyp_video_rpc;
grant usage on schema public,storage to wyp_media_validator;
grant create on schema public,private to wyp_video_rpc;
grant execute on function private.current_user_id(),private.require_verified_user(),private.creator_allowed(),private.require_creator(),private.creator_object(jsonb,text[]),private.decode_creator_cursor(text),private.encode_creator_cursor(jsonb) to wyp_video_rpc;
grant select on public.profiles to wyp_video_rpc;
create policy profiles_video_read on public.profiles for select to wyp_video_rpc using(user_id=private.current_user_id());
grant select on public.scenarios,public.scenario_versions,private.scenario_drafts,public.training_sessions,public.training_session_items,public.attempts to wyp_video_rpc;
create policy scenarios_video_read on public.scenarios for select to wyp_video_rpc using(true);
create policy versions_video_read on public.scenario_versions for select to wyp_video_rpc using(true);
create policy drafts_video_read on private.scenario_drafts for select to wyp_video_rpc using(true);
create policy sessions_video_read on public.training_sessions for select to wyp_video_rpc using(user_id=private.current_user_id());
create policy items_video_read on public.training_session_items for select to wyp_video_rpc using(user_id=private.current_user_id());
create policy attempts_video_read on public.attempts for select to wyp_video_rpc using(user_id=private.current_user_id());

create table private.video_assets (
 id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete set null,
 bucket text not null default 'creator-vods' check(bucket='creator-vods'), object_path text not null unique,
 file_name text not null check(length(file_name) between 1 and 255), content_fingerprint text not null check(content_fingerprint ~ '^[0-9a-f]{64}$'),
 byte_size bigint not null check(byte_size between 1 and 2147483648), actual_byte_size bigint,
 state text not null default 'pending_upload' check(state in ('pending_upload','uploaded','validating','ready','rejected','deleting','deleted')),
 revision integer not null default 0 check(revision>=0), metadata jsonb,
 object_version text, failure_code text, retryable boolean not null default false,
 validation_fence uuid, validation_until timestamptz, validation_attempts integer not null default 0,
 upload_url text, upload_init_fence uuid, upload_init_until timestamptz,
 upload_expires_at timestamptz not null default now()+interval '24 hours',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(actual_byte_size is null or actual_byte_size=byte_size),
 check(state<>'ready' or (metadata is not null and object_version is not null and actual_byte_size=byte_size))
);
create index video_owner_page on private.video_assets(owner_id,created_at desc,id desc);
create index video_pending_validation on private.video_assets(state,created_at) where state in ('uploaded','validating');
create table private.video_asset_commands (
 actor_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 operation text not null, payload jsonb not null, asset_id uuid not null references private.video_assets(id),
 created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
create trigger immutable_video_command before update on private.video_asset_commands for each row execute function private.reject_immutable_change();
create table private.scenario_draft_assets (
 scenario_id text primary key references private.scenario_drafts(scenario_id), asset_id uuid not null references private.video_assets(id)
);
create table private.scenario_version_assets (
 version_id uuid primary key references public.scenario_versions(id), asset_id uuid not null references private.video_assets(id)
);
create trigger immutable_version_asset before update or delete on private.scenario_version_assets for each row execute function private.reject_immutable_change();
create table private.media_validator_identity(singleton boolean primary key default true check(singleton),project_id text not null);
create table private.media_validator_status(singleton boolean primary key default true check(singleton),last_seen_at timestamptz not null);

do $$ declare t text; begin
 foreach t in array array['video_assets','video_asset_commands','scenario_draft_assets','scenario_version_assets','media_validator_identity','media_validator_status'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('alter table private.%I force row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,wyp_media_validator',t);
  execute format('grant select,insert,update,delete on private.%I to wyp_video_rpc',t);
  execute format('create policy video_rpc_access on private.%I for all to wyp_video_rpc using(true) with check(true)',t);
 end loop;
end $$;
revoke insert,update,delete on private.media_validator_identity from wyp_video_rpc;
revoke update,delete on private.video_asset_commands,private.scenario_version_assets from wyp_video_rpc;

create function private.media_worker_allowed() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')='wyp_media_validator'
 and exists(select 1 from private.media_validator_identity where project_id=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'wyp_project_id'),false);
$$;
create function private.require_media_worker() returns void
language plpgsql stable security invoker set search_path='' as $$
begin if not private.media_worker_allowed() then raise exception using errcode='42501',message='Media validator identity required'; end if; end $$;
create function private.video_is_referenced(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.scenario_draft_assets where asset_id=p_id) or exists(select 1 from private.scenario_version_assets where asset_id=p_id);
$$;
create function private.video_snapshot(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a private.video_assets; begin
 select * into a from private.video_assets where id=p_id and owner_id=private.current_user_id();
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 return jsonb_build_object('id',a.id,'revision',a.revision,'fileName',a.file_name,'contentFingerprint',a.content_fingerprint,
 'state',a.state,'byteSize',a.byte_size,'actualByteSize',a.actual_byte_size,'metadata',a.metadata,
 'failure',case when a.failure_code is null then null else jsonb_build_object('code',a.failure_code,'message',case when a.retryable then 'Video validation was interrupted. Try again after the validator is available.' else 'This video could not be validated. Use a supported MP4 recording.' end,'retryable',a.retryable) end,
 'uploadExpiresAt',a.upload_expires_at,'createdAt',a.created_at,'updatedAt',a.updated_at,
 'canDelete',a.state<>'deleted' and not private.video_is_referenced(a.id));
end $$;
create function private.video_command_replay(p_actor uuid,p_request uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c private.video_asset_commands; begin
 select * into c from private.video_asset_commands where actor_id=p_actor and request_id=p_request;
 if not found then return null; end if;
 if c.operation<>p_operation or c.payload<>p_payload then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
 return jsonb_build_object('video',private.video_snapshot(c.asset_id),'replayed',true);
end $$;
create function private.record_video_command(p_actor uuid,p_request uuid,p_operation text,p_payload jsonb,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 insert into private.video_asset_commands(actor_id,request_id,operation,payload,asset_id) values(p_actor,p_request,p_operation,p_payload,p_id);
 return jsonb_build_object('video',private.video_snapshot(p_id),'replayed',false);
end $$;
create function private.lock_owned_video(p_id uuid,p_revision integer default null) returns private.video_assets
language plpgsql security invoker set search_path='' as $$
declare a private.video_assets; begin
 select * into a from private.video_assets where id=p_id and owner_id=private.current_user_id() for update;
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 if p_revision is not null and a.revision<>p_revision then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 return a;
end $$;
create function private.video_upload_descriptor(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a private.video_assets; begin
 select * into a from private.video_assets where id=p_id and owner_id=private.current_user_id();
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 return jsonb_build_object('assetId',a.id,'bucket',a.bucket,'objectPath',a.object_path,'uploadUrl',a.upload_url,'expiresAt',a.upload_expires_at,'byteSize',a.byte_size,'mimeType','video/mp4');
end $$;

create function public.create_creator_video(p_request_id uuid,p_file_name text,p_byte_size bigint,p_mime_type text,p_content_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); aid uuid:=gen_random_uuid(); payload jsonb; replay jsonb; used bigint; pending integer; begin
 if p_request_id is null or p_file_name is null or length(p_file_name) not between 1 and 255 or p_file_name ~ '[[:cntrl:]]' or p_file_name !~* '\.mp4$' or p_byte_size is null or p_byte_size not between 1 and 2147483648 or p_mime_type is distinct from 'video/mp4' or p_content_fingerprint is null or p_content_fingerprint !~ '^[0-9a-f]{64}$' then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 payload:=jsonb_build_object('fileName',p_file_name,'byteSize',p_byte_size,'mimeType',p_mime_type,'contentFingerprint',p_content_fingerprint);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5));
 replay:=private.video_command_replay(actor,p_request_id,'create',payload); if replay is not null then return replay; end if;
 select coalesce(sum(byte_size) filter(where state<>'deleted'),0),count(*) filter(where state in ('pending_upload','uploaded','validating')) into used,pending from private.video_assets where owner_id=actor;
 if used+p_byte_size>10737418240 or pending>=3 then raise exception using errcode='P0001',message='UPLOAD_LIMIT_REACHED'; end if;
 insert into private.video_assets(id,owner_id,object_path,file_name,byte_size,content_fingerprint) values(aid,actor,actor::text||'/'||aid::text||'/source.mp4',p_file_name,p_byte_size,p_content_fingerprint);
 return private.record_video_command(actor,p_request_id,'create',payload,aid);
end $$;
create function public.get_creator_video(p_asset_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$ begin perform private.require_creator(); return private.video_snapshot(p_asset_id); end $$;
create function public.get_creator_video_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); aid uuid; begin
 select asset_id into aid from private.video_asset_commands where actor_id=actor and request_id=p_request_id and operation='create';
 return jsonb_build_object('video',case when aid is null then null else private.video_snapshot(aid) end);
end $$;
create function public.list_creator_videos(p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); cur jsonb; cursor_at timestamptz; cursor_id uuid; result jsonb; more boolean; last_at timestamptz; last_id text; seen timestamptz; begin
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

-- The server creates the empty TUS session and saves its opaque URL. No uploaded bytes
-- pass through Next.js. A lease serializes initialization without a network transaction.
create function public.get_creator_video_upload_session(p_asset_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; fence uuid; begin
 perform private.require_creator(); a:=private.lock_owned_video(p_asset_id);
 if a.state<>'pending_upload' then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 if a.upload_expires_at<=now() then raise exception using errcode='P0001',message='UPLOAD_EXPIRED'; end if;
 if a.upload_url is not null then return jsonb_build_object('video',private.video_snapshot(a.id),'upload',private.video_upload_descriptor(a.id),'initializationFence',null); end if;
 if a.upload_init_until>now() then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 fence:=gen_random_uuid(); update private.video_assets set upload_init_fence=fence,upload_init_until=now()+interval '30 seconds' where id=a.id;
 return jsonb_build_object('video',private.video_snapshot(a.id),'upload',private.video_upload_descriptor(a.id),'initializationFence',fence);
end $$;
create function public.finish_creator_video_upload_session(p_asset_id uuid,p_fence uuid,p_upload_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; begin
 perform private.require_creator(); a:=private.lock_owned_video(p_asset_id);
 if a.state<>'pending_upload' or a.upload_init_fence is distinct from p_fence or p_fence is null or a.upload_init_until<=now() then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 if p_upload_url is null or length(p_upload_url)>2048 or p_upload_url !~ '^https?://[^/?#]+/storage/v1/upload/resumable/[^?#]+$' then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 update private.video_assets set upload_url=p_upload_url,upload_init_fence=null,upload_init_until=null where id=a.id;
 return jsonb_build_object('video',private.video_snapshot(a.id),'upload',private.video_upload_descriptor(a.id));
end $$;
create function public.release_creator_video_upload_session(p_asset_id uuid,p_fence uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 perform private.require_creator(); update private.video_assets set upload_init_fence=null,upload_init_until=null where id=p_asset_id and owner_id=private.current_user_id() and upload_init_fence=p_fence and state='pending_upload'; return found;
end $$;

create function public.complete_creator_video_upload(p_asset_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; o storage.objects; payload jsonb:=jsonb_build_object('assetId',p_asset_id,'expectedRevision',p_expected_revision); replay jsonb; size bigint; begin
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
create function public.retry_creator_video_validation(p_asset_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; payload jsonb:=jsonb_build_object('assetId',p_asset_id,'expectedRevision',p_expected_revision); replay jsonb; begin
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5)); replay:=private.video_command_replay(actor,p_request_id,'retry',payload); if replay is not null then return replay; end if;
 a:=private.lock_owned_video(p_asset_id,p_expected_revision);
 if a.state<>'rejected' or not a.retryable or a.validation_attempts>=3 then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 update private.video_assets set state='uploaded',failure_code=null,retryable=false,revision=revision+1,updated_at=now() where id=a.id;
 return private.record_video_command(actor,p_request_id,'retry',payload,a.id);
end $$;
create function public.begin_creator_video_delete(p_asset_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; payload jsonb:=jsonb_build_object('assetId',p_asset_id,'expectedRevision',p_expected_revision); replay jsonb; begin
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
create function public.finish_creator_video_delete(p_asset_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator(); a private.video_assets; c private.video_asset_commands; begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text,5)); a:=private.lock_owned_video(p_asset_id);
 select * into c from private.video_asset_commands where actor_id=actor and request_id=p_request_id and operation='delete' and asset_id=a.id;
 if not found then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 if a.state='deleted' then return jsonb_build_object('video',private.video_snapshot(a.id),'replayed',true); end if;
 if a.state<>'deleting' or private.video_is_referenced(a.id) then raise exception using errcode='P0001',message='VIDEO_IN_USE'; end if;
 if exists(select 1 from storage.objects where bucket_id=a.bucket and name=a.object_path) then raise exception using errcode='P0001',message='VIDEO_CONFLICT'; end if;
 update private.video_assets set state='deleted',revision=revision+1,upload_url=null,updated_at=now() where id=a.id;
 return jsonb_build_object('video',private.video_snapshot(a.id),'replayed',false);
end $$;

create function public.report_video_validator_heartbeat() returns boolean
language plpgsql security definer set search_path='' as $$ begin
 perform private.require_media_worker(); insert into private.media_validator_status(singleton,last_seen_at) values(true,now()) on conflict(singleton) do update set last_seen_at=excluded.last_seen_at; return true;
end $$;
create function public.claim_video_validation() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; fence uuid:=gen_random_uuid(); begin
 perform private.require_media_worker();
 -- Expired final attempts fail visibly instead of remaining permanently validating.
 update private.video_assets set state='rejected',failure_code='MEDIA_VALIDATOR_STOPPED',retryable=false,revision=revision+1,updated_at=now() where state='validating' and validation_until<=now() and validation_attempts>=3;
 select * into a from private.video_assets where state='uploaded' or state='validating' and validation_until<=now() and validation_attempts<3 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update private.video_assets set state='validating',validation_fence=fence,validation_until=now()+interval '120 seconds',validation_attempts=validation_attempts+1,revision=revision+1,updated_at=now() where id=a.id;
 return jsonb_build_object('assetId',a.id,'fence',fence,'bucket',a.bucket,'objectPath',a.object_path,'objectVersion',a.object_version,'byteSize',a.actual_byte_size,'leaseExpiresAt',now()+interval '120 seconds');
end $$;
create function public.renew_video_validation_lease(p_asset_id uuid,p_fence uuid) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 perform private.require_media_worker(); update private.video_assets set validation_until=now()+interval '120 seconds' where id=p_asset_id and state='validating' and validation_fence=p_fence and validation_until>now(); return found;
end $$;
create function public.complete_video_validation(p_asset_id uuid,p_fence uuid,p_object_version text,p_metadata jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; o storage.objects; duration numeric; w integer; h integer; begin
 perform private.require_media_worker();
 select * into a from private.video_assets where id=p_asset_id and state='validating' and validation_fence=p_fence and validation_until>now() for update;
 if not found then return false; end if;
 select * into o from storage.objects where bucket_id=a.bucket and name=a.object_path;
 if not found or p_object_version is distinct from a.object_version or o.id::text||':'||coalesce(o.version,'') is distinct from a.object_version or (o.metadata->>'size')::bigint is distinct from a.byte_size then return false; end if;
 if not private.creator_object(p_metadata,array['durationSeconds','width','height','videoCodec','pixelFormat','audioCodec']) or jsonb_typeof(p_metadata->'durationSeconds') is distinct from 'number' or jsonb_typeof(p_metadata->'width') is distinct from 'number' or jsonb_typeof(p_metadata->'height') is distinct from 'number' or p_metadata->>'videoCodec' is distinct from 'h264' or p_metadata->>'pixelFormat' is distinct from 'yuv420p' or not (p_metadata->'audioCodec'='null'::jsonb or p_metadata->>'audioCodec'='aac') then raise exception using errcode='P0001',message='VIDEO_UNSUPPORTED'; end if;
 duration:=(p_metadata->>'durationSeconds')::numeric; w:=(p_metadata->>'width')::integer; h:=(p_metadata->>'height')::integer;
 if duration<=0 or duration>7200 or w<1 or w>1920 or h<1 or h>1080 or (p_metadata->>'width')::numeric<>w or (p_metadata->>'height')::numeric<>h then raise exception using errcode='P0001',message='VIDEO_UNSUPPORTED'; end if;
 update private.video_assets set state='ready',metadata=p_metadata,failure_code=null,retryable=false,validation_fence=null,validation_until=null,revision=revision+1,updated_at=now() where id=a.id; return true;
end $$;
create function public.fail_video_validation(p_asset_id uuid,p_fence uuid,p_code text,p_retryable boolean) returns boolean
language plpgsql security definer set search_path='' as $$ begin
 perform private.require_media_worker();
 if p_code is null or p_code not in ('VIDEO_UNSUPPORTED','MEDIA_PROBE_FAILED','MEDIA_PROBE_TIMEOUT','MEDIA_SOURCE_UNAVAILABLE','MEDIA_VALIDATOR_STOPPED') or p_retryable is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 update private.video_assets set state='rejected',failure_code=p_code,retryable=p_retryable and p_code<>'VIDEO_UNSUPPORTED' and validation_attempts<3,validation_fence=null,validation_until=null,revision=revision+1,updated_at=now()
 where id=p_asset_id and state='validating' and validation_fence=p_fence and validation_until>now(); return found;
end $$;

-- Storage helpers run as a narrow non-login role, never as a table owner or bypass-RLS role.
create function private.video_can_insert(p_path text,p_metadata jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a private.video_assets; size bigint; begin
 if not private.creator_allowed() then return false; end if;
 -- Keep final Storage insertion serialized against begin-delete until its
 -- transaction commits; otherwise deletion could confirm absence too early.
 select * into a from private.video_assets where object_path=p_path and owner_id=private.current_user_id() and state='pending_upload' and upload_expires_at>now() for share;
 if not found then return false; end if;
 if p_metadata->>'size' is null then return true; end if;
 begin size:=(p_metadata->>'size')::bigint; exception when others then return false; end;
 return size=a.byte_size;
end $$;
create function private.video_can_read(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a private.video_assets; actor uuid; begin
 select * into a from private.video_assets where object_path=p_path;
 if not found or a.state='deleted' then return false; end if;
 if private.media_worker_allowed() then return a.state='validating' and a.validation_until>now(); end if;
 actor:=private.require_verified_user();
 if a.owner_id=actor and private.creator_allowed() then return true; end if;
 if a.state<>'ready' then return false; end if;
 return exists(select 1 from private.scenario_version_assets r join public.scenarios s on s.current_version=r.version_id where r.asset_id=a.id and s.is_published and s.creator_id is not null)
 or exists(select 1 from private.scenario_version_assets r join public.training_session_items i on i.scenario_version_id=r.version_id where r.asset_id=a.id and i.user_id=actor);
exception when others then return false;
end $$;
create function private.video_can_delete(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a private.video_assets; begin
 if not private.creator_allowed() then return false; end if;
 select * into a from private.video_assets where object_path=p_path and owner_id=private.current_user_id() and state='deleting';
 return found and not private.video_is_referenced(a.id);
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('creator-vods','creator-vods',false,2147483648,array['video/mp4']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
grant select on storage.objects to wyp_video_rpc;
create policy video_rpc_object_read on storage.objects for select to wyp_video_rpc using(bucket_id='creator-vods');
create policy video_object_insert on storage.objects for insert to authenticated with check(bucket_id='creator-vods' and private.video_can_insert(name,metadata));
create policy video_object_read on storage.objects for select to authenticated,wyp_media_validator using(bucket_id='creator-vods' and private.video_can_read(name));
create policy video_object_delete on storage.objects for delete to authenticated using(bucket_id='creator-vods' and private.video_can_delete(name));
grant select on storage.objects to wyp_media_validator;

-- Explicit function inventory keeps default schema privileges closed.
do $$ declare fn record; worker boolean; begin
 for fn in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 n.nspname='private' and p.proname=any(array['media_worker_allowed','require_media_worker','video_is_referenced','video_snapshot','video_command_replay','record_video_command','lock_owned_video','video_upload_descriptor','video_can_insert','video_can_read','video_can_delete'])
 or n.nspname='public' and p.proname=any(array['create_creator_video','get_creator_video','get_creator_video_request','list_creator_videos','get_creator_video_upload_session','finish_creator_video_upload_session','release_creator_video_upload_session','complete_creator_video_upload','retry_creator_video_validation','begin_creator_video_delete','finish_creator_video_delete','report_video_validator_heartbeat','claim_video_validation','renew_video_validation_lease','complete_video_validation','fail_video_validation']) loop
  execute format('alter function %s owner to wyp_video_rpc',fn.signature);
  execute format('revoke all on function %s from public,anon,authenticated,wyp_media_validator',fn.signature);
  if fn.nspname='public' then
   worker:=fn.proname=any(array['report_video_validator_heartbeat','claim_video_validation','renew_video_validation_lease','complete_video_validation','fail_video_validation']);
   execute format('grant execute on function %s to %I',fn.signature,case when worker then 'wyp_media_validator' else 'authenticated' end);
  end if;
 end loop;
end $$;
grant usage on schema private to authenticated,wyp_media_validator;
grant execute on function private.video_can_insert(text,jsonb),private.video_can_read(text),private.video_can_delete(text) to authenticated;
grant execute on function private.video_can_read(text) to wyp_media_validator;
revoke create on schema public,private from wyp_video_rpc;
