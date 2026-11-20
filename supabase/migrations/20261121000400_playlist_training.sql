begin;
grant create on schema public,private to wyp_rpc;
alter table public.training_sessions add column target_playlist_id uuid references public.playlists(id),add column target_playlist_version_id uuid,add column target_playlist_metadata jsonb,
 add constraint session_playlist_version foreign key(target_playlist_version_id,target_playlist_id) references private.playlist_versions(id,playlist_id);
alter table public.training_sessions drop constraint training_target_shape;
alter table public.training_sessions add constraint training_target_shape check(
 (target_kind='demo' and target_scenario_id is null and target_playlist_id is null and target_playlist_version_id is null and target_playlist_metadata is null)
 or(target_kind='scenario' and target_scenario_id is not null and target_playlist_id is null and target_playlist_version_id is null and target_playlist_metadata is null)
 or(target_kind='playlist' and target_scenario_id is null and target_playlist_id is not null and target_playlist_version_id is not null and target_playlist_metadata is not null and jsonb_typeof(target_playlist_metadata)='object'));
alter table private.session_commands drop constraint session_commands_operation_check;
alter table private.session_commands add constraint session_commands_operation_check check(operation in('start','selected-start','playlist-start','answer','advance'));
create or replace function private.reject_session_target_change() returns trigger language plpgsql set search_path='' as $$
begin
 if(new.target_kind,new.target_scenario_id,new.target_title,new.target_playlist_id,new.target_playlist_version_id,new.target_playlist_metadata) is distinct from(old.target_kind,old.target_scenario_id,old.target_title,old.target_playlist_id,old.target_playlist_version_id,old.target_playlist_metadata) then raise exception using errcode='P0001',message='IMMUTABLE_RECORD';end if;return new;
end $$;
create function private.session_target(p_kind text,p_scenario_id text,p_playlist_id uuid) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if p_kind='playlist' and p_playlist_id is not null then return jsonb_build_object('kind','playlist','playlistId',p_playlist_id);end if;
 if p_kind in('demo','scenario') and p_playlist_id is null then return private.session_target(p_kind,p_scenario_id);end if;
 raise exception using errcode='P0001',message='STORAGE_UNAVAILABLE';
end $$;
create or replace function private.read_session_snapshot(p_session_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s public.training_sessions;items jsonb;begin
 select * into s from public.training_sessions where id=p_session_id and user_id=private.current_user_id();if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'position',i.position,'challenge',v.challenge,'answer',case when a.id is null then null else jsonb_build_object('id',a.id,'answeredAt',a.answered_at,'result',a.answer) end) order by i.position),'[]'::jsonb) into items
 from public.training_session_items i join public.scenario_versions v on v.id=i.scenario_version_id left join public.attempts a on a.item_id=i.id and a.user_id=private.current_user_id() where i.session_id=p_session_id and i.user_id=private.current_user_id();
 return jsonb_build_object('id',s.id,'status',case when s.phase='completed' then 'completed' else 'in_progress' end,'phase',s.phase,'revision',s.revision,'currentIndex',s.current_index,'createdAt',s.created_at,'updatedAt',s.updated_at,'completedAt',s.completed_at,'items',items,'target',private.session_target(s.target_kind,s.target_scenario_id,s.target_playlist_id),'title',s.target_title)
 ||case when s.target_kind='playlist' then jsonb_build_object('playlist',s.target_playlist_metadata) else '{}'::jsonb end;
end $$;
create or replace function private.session_summary(p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',s.id,'status',case when s.phase='completed' then 'completed' else 'in_progress' end,
 'answeredCount',(select count(*) from public.attempts a where a.session_id=s.id and a.user_id=private.current_user_id()),'totalCount',(select count(*) from public.training_session_items i where i.session_id=s.id and i.user_id=private.current_user_id()),
 'createdAt',s.created_at,'updatedAt',s.updated_at,'completedAt',s.completed_at,'target',private.session_target(s.target_kind,s.target_scenario_id,s.target_playlist_id),'title',s.target_title)
 ||case when s.target_kind='playlist' then jsonb_build_object('playlist',s.target_playlist_metadata) else '{}'::jsonb end
 from public.training_sessions s where id=p_session_id and user_id=private.current_user_id();
$$;
create or replace function private.match_session_command(p_user_id uuid,p_request_id uuid,p_operation text,p_payload jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare c private.session_commands;r jsonb;begin
 select * into c from private.session_commands where user_id=p_user_id and request_id=p_request_id;if not found then return null;end if;
 if c.operation<>p_operation or c.payload<>p_payload or c.payload_fingerprint<>md5(p_payload::text) then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';end if;
 r:=jsonb_build_object('session',private.read_session_snapshot(c.session_id),'replayed',true);
 if p_operation in('start','selected-start','playlist-start') then r:=r||jsonb_build_object('created',c.created_session);end if;return r;
end $$;
create function private.start_playlist_session(p_request_id uuid,p_playlist_id uuid,p_expected_publication_version uuid) returns jsonb language plpgsql set search_path='' as $$
declare actor uuid:=private.require_verified_user();s public.training_sessions;p public.playlists;v private.playlist_versions;payload jsonb;replay jsonb;created boolean:=false;begin
 if p_request_id is null or p_playlist_id is null or p_expected_publication_version is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('target',jsonb_build_object('kind','playlist','playlistId',p_playlist_id),'expectedPublicationVersion',p_expected_publication_version);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));replay:=private.match_session_command(actor,p_request_id,'playlist-start',payload);if replay is not null then return replay;end if;
 select * into s from public.training_sessions where user_id=actor and phase<>'completed' for update;
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
create function public.start_playlist_training_session(p_request_id uuid,p_playlist_id uuid,p_expected_publication_version uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return private.start_playlist_session(p_request_id,p_playlist_id,p_expected_publication_version);end $$;
create or replace function public.list_training_sessions(p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user();cur public.training_sessions;rows jsonb;more boolean;next_id text;begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 if p_cursor is not null then
  if p_cursor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
  select * into cur from public.training_sessions where id=p_cursor::uuid and user_id=actor;if not found then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 end if;
 with page as(select s.*,row_number() over(order by s.created_at desc,s.id desc) n from public.training_sessions s where s.user_id=actor and(p_cursor is null or(s.created_at,s.id)<(cur.created_at,cur.id)) order by s.created_at desc,s.id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.session_summary(id) order by n) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit,max(id::text) filter(where n=p_limit) into rows,more,next_id from page;
 return jsonb_build_object('sessions',rows,'nextCursor',case when more then next_id else null end);
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=any(array['reject_session_target_change','session_target','read_session_snapshot','session_summary','match_session_command','start_playlist_session']) or n.nspname='public' and p.proname=any(array['start_playlist_training_session','list_training_sessions']) loop
 execute format('alter function %s owner to wyp_rpc',f.sig);execute format('revoke all on function %s from public,anon,authenticated',f.sig);if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end $$;
revoke create on schema public,private from wyp_rpc;
commit;
