begin;
grant create on schema public,private to wyp_moderation_rpc,wyp_playlist_fence;
-- Hides and withdrawals both invalidate old playlist approvals. A hide is not a creator withdrawal.
alter table private.scenario_availability_fences add column last_changed_at timestamptz;
alter table private.scenario_availability_fences add column last_change_reason text;
update private.scenario_availability_fences set last_changed_at=last_withdrawn_at,last_change_reason='withdrawal';
alter table private.scenario_availability_fences alter column last_changed_at set not null;
alter table private.scenario_availability_fences alter column last_changed_at set default now();
alter table private.scenario_availability_fences alter column last_change_reason set not null;
alter table private.scenario_availability_fences add constraint availability_change_reason check(last_change_reason in('withdrawal','operator_hide'));
alter table private.scenario_availability_fences alter column last_withdrawn_at drop not null;
alter table private.scenario_availability_fences alter column last_withdrawn_at drop default;
grant update(last_changed_at,last_change_reason) on private.scenario_availability_fences to wyp_playlist_fence;
create function private.bump_scenario_availability(p_id text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_reason not in('withdrawal','operator_hide') or p_reason is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 insert into private.scenario_availability_fences(scenario_id,generation,last_withdrawn_at,last_changed_at,last_change_reason)
 values(p_id,1,case when p_reason='withdrawal' then now() else null end,now(),p_reason)
 on conflict(scenario_id) do update set generation=private.scenario_availability_fences.generation+1,
 last_withdrawn_at=case when p_reason='withdrawal' then now() else private.scenario_availability_fences.last_withdrawn_at end,
 last_changed_at=now(),last_change_reason=p_reason;
end $$;
alter function private.bump_scenario_availability(text,text) owner to wyp_playlist_fence;
revoke all on function private.bump_scenario_availability(text,text) from public,anon,authenticated;
grant execute on function private.bump_scenario_availability(text,text) to wyp_moderation_rpc;
create or replace function private.note_scenario_withdrawal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.is_published and not new.is_published then perform private.bump_scenario_availability(new.id,'withdrawal');end if;
 return new;
end $$;
create function public.set_operator_scenario_visibility(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_hidden boolean,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user();payload jsonb;replay jsonb;h private.scenario_visibility;rev integer;reason text;before_state jsonb;after_state jsonb;begin
 if not private.is_catalogue_scenario_id(p_scenario_id) or p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_hidden is null or p_reason is null or length(p_reason)>1000 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 reason:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');if reason='' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision,'hidden',p_hidden,'reason',reason);
 perform pg_advisory_xact_lock(hashtextextended('moderation:'||actor::text,9));perform private.lock_operator_access();
 perform pg_advisory_xact_lock(hashtextextended('scenario:'||p_scenario_id,2));
 replay:=private.match_moderation_command(actor,p_request_id,'visibility',payload);if replay is not null then return replay;end if;
 if not exists(select 1 from public.scenarios where id=p_scenario_id and current_version is not null) then raise exception using errcode='P0001',message='SCENARIO_NOT_FOUND';end if;
 select * into h from private.scenario_visibility where scenario_id=p_scenario_id for update;rev:=coalesce(h.revision,0);
 if rev<>p_expected_revision or coalesce(h.hidden,false)=p_hidden then raise exception using errcode='P0001',message='VISIBILITY_CONFLICT';end if;
 before_state:=private.operator_visibility_json(p_scenario_id);
 insert into private.scenario_visibility(scenario_id,hidden,revision,reason,changed_by) values(p_scenario_id,p_hidden,rev+1,reason,actor)
 on conflict(scenario_id) do update set hidden=excluded.hidden,revision=excluded.revision,reason=excluded.reason,changed_at=now(),changed_by=actor;
 if p_hidden then perform private.bump_scenario_availability(p_scenario_id,'operator_hide');end if;
 after_state:=private.operator_visibility_json(p_scenario_id);
 perform private.record_moderation_command(actor,p_request_id,'visibility',payload,null,p_scenario_id,rev+1);
 insert into private.moderation_events(actor_id,request_id,action,target_id,before_state,after_state,reason)
 values(actor,p_request_id,case when p_hidden then 'hide' else 'restore' end,p_scenario_id,before_state,after_state,reason);
 return jsonb_build_object('visibility',after_state,'replayed',false);
end $$;
alter function public.set_operator_scenario_visibility(text,uuid,integer,boolean,text) owner to wyp_moderation_rpc;
revoke all on function public.set_operator_scenario_visibility(text,uuid,integer,boolean,text) from public,anon;
grant execute on function public.set_operator_scenario_visibility(text,uuid,integer,boolean,text) to authenticated;
-- Narrow capabilities: the playback role cannot enumerate reports or membership rows.
create function private.operator_report_asset(p_report_id uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare aid uuid;vid uuid;begin
 perform private.require_operator();
 select scenario_version_id into vid from private.scenario_reports where id=p_report_id;
 if not found then raise exception using errcode='P0001',message='REPORT_NOT_FOUND';end if;
 select asset_id into aid from private.scenario_version_assets where version_id=vid;
 if aid is null then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND';end if;return aid;
end $$;
create function private.operator_report_asset_allowed(p_asset_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.operator_allowed() and exists(select 1 from private.scenario_reports r join private.scenario_version_assets a on a.version_id=r.scenario_version_id where a.asset_id=p_asset_id);
$$;
alter function private.operator_report_asset(uuid) owner to wyp_moderation_rpc;
alter function private.operator_report_asset_allowed(uuid) owner to wyp_moderation_rpc;
revoke all on function private.operator_report_asset(uuid),private.operator_report_asset_allowed(uuid) from public,anon,authenticated;
grant execute on function private.operator_report_asset(uuid),private.operator_report_asset_allowed(uuid) to wyp_video_rpc;

-- One availability predicate covers every public discovery and new-play surface.
create or replace function private.library_preview(p_scenario_id text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select private.scenario_preview(v.challenge)||jsonb_build_object(
    'contentVersion',v.content_version,'player',jsonb_build_object('id',p.id,'displayName',p.display_name),
    'editorialOrigin',case when s.is_demo then 'curated' else 'creator' end,
    'provenance',k.answer_key->'analysis'->'author','publishedAt',s.published_at)
  from public.scenarios s join public.scenario_versions v on v.id=s.current_version
  join private.scenario_answer_keys k on k.scenario_version_id=v.id
  join private.scenario_version_players m on m.scenario_version_id=v.id
  join public.players p on p.id=m.player_id
  where s.id=p_scenario_id and private.scenario_publicly_available(s.id);
$$;

create or replace function public.list_library_previews(p_cursor text default null,p_limit integer default 20,p_player_id uuid default null) returns jsonb
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
    where private.scenario_publicly_available(s.id) and (p_player_id is null or m.player_id=p_player_id)
      and (p_cursor is null or (coalesce(s.first_published_at,s.created_at),s.id)<(cursor_at,cursor_id))
    order by coalesce(s.first_published_at,s.created_at) desc,s.id desc limit p_limit+1
  ) select coalesce(jsonb_agg(private.library_preview(id) order by n) filter(where n<=p_limit),'[]'),count(*)>p_limit,
      max(ordered_at) filter(where n=p_limit),max(id) filter(where n=p_limit) into rows,more,next_at,next_id from page;
  return jsonb_build_object('scenarios',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','scenarios','playerId',p_player_id,'at',next_at,'id',next_id)) else null end);
end $$;

create or replace function public.list_library_players(p_query text default '',p_cursor text default null,p_limit integer default 12) returns jsonb
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
    where private.scenario_publicly_available(s.id)
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

create or replace function public.get_library_player(p_player_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 select jsonb_build_object('id',p.id,'displayName',p.display_name) into result from public.players p where p.id=p_player_id and (
 exists(select 1 from private.scenario_version_players m join public.scenarios s on s.current_version=m.scenario_version_id where m.player_id=p.id and private.scenario_publicly_available(s.id))
 or exists(select 1 from private.playlist_version_players m where m.player_id=p.id and private.playlist_publication_available(m.publication_id)));
 return result;
end $$;

create or replace function public.list_scenario_previews() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.scenario_preview(v.challenge) order by s.sort_order, s.id), '[]'::jsonb)
  from public.scenarios s join public.scenario_versions v on v.id = s.current_version
  where s.is_demo and private.scenario_publicly_available(s.id);
$$;

create or replace function public.get_scenario_preview(p_scenario_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.scenario_preview(v.challenge)
  from public.scenarios s join public.scenario_versions v on v.id = s.current_version
  where s.id = p_scenario_id and s.is_demo and private.scenario_publicly_available(s.id);
$$;

create or replace function private.start_target_session(p_request_id uuid,p_target jsonb,p_legacy boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare actor uuid:=private.require_verified_user(); s public.training_sessions; scenario public.scenarios; replay jsonb; created boolean:=false;
  payload jsonb; operation text; count_items integer; target_kind text; target_id text; lock_id text;
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
      select * into scenario from public.scenarios where id=target_id and private.scenario_publicly_available(id);
      if not found then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
      insert into public.training_sessions(user_id,target_kind,target_scenario_id,target_title) values(actor,'scenario',target_id,scenario.title) returning * into s;
      insert into public.training_session_items(session_id,user_id,position,scenario_version_id) values(s.id,actor,0,scenario.current_version);
    else
      -- Lock the complete intended demo, including unavailable entries; never silently shorten it.
      for lock_id in select id from public.scenarios where is_demo order by id loop
        perform pg_advisory_xact_lock(hashtextextended('scenario:'||lock_id,2));
      end loop;
      if exists(select 1 from public.scenarios where is_demo and not private.scenario_publicly_available(id)) then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE';end if;
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

create or replace function private.playlist_publication_available(p_version uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.playlist_versions v join public.playlists p on p.id=v.playlist_id where v.id=p_version and p.is_published and p.current_version=v.id
 and (select count(*) from private.playlist_version_items i where i.publication_id=v.id) between 1 and 20
 and not exists(select 1 from private.playlist_version_items i left join public.scenarios s on s.id=i.scenario_id where i.publication_id=v.id and (s.id is null or not private.scenario_publicly_available(s.id) or i.availability_generation<>private.current_scenario_availability_generation(i.scenario_id) or not private.playlist_version_media_ready(i.scenario_version_id))));
$$;

create or replace function private.playlist_selection_details(p_content jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare rows jsonb:='[]';sel jsonb;i integer:=0;v public.scenario_versions;s public.scenarios;pv jsonb;issues jsonb;cur text;begin
 for sel in select value from jsonb_array_elements(p_content->'items') loop
  issues:='[]';pv:=null;cur:=null;
  select * into s from public.scenarios where id=sel->>'scenarioId' and creator_id=private.current_user_id() and not is_demo;
  if not found then issues:=private.creator_issue('items.'||i,'INVALID_SELECTION','Choose one of your published scenarios.');
  else
   select * into v from public.scenario_versions where scenario_id=s.id and content_version=sel->>'scenarioVersion';
   if not found then issues:=private.creator_issue('items.'||i,'INVALID_SELECTION','The selected scenario version is unavailable.');
   else
    pv:=private.playlist_item_preview(v.id);
    if pv is null then issues:=issues||private.creator_issue('items.'||i,'PLAYER_REQUIRED','The selected version has no valid player attribution.');end if;
    if not private.playlist_version_media_ready(v.id) then issues:=issues||private.creator_issue('items.'||i,'MEDIA_UNAVAILABLE','The selected recording is unavailable.');end if;
   end if;
   if not private.scenario_publicly_available(s.id) then issues:=issues||private.creator_issue('items.'||i,'SCENARIO_UNAVAILABLE','This scenario is unavailable. Restore its availability or remove it from the playlist.');
   else select content_version into cur from public.scenario_versions where id=s.current_version;end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('position',i,'selection',sel,'preview',pv,'currentVersion',cur,'issues',issues));i:=i+1;
 end loop;return rows;
end $$;

create or replace function private.read_creator_playlist(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.playlists;d private.playlist_drafts;r private.playlist_reviews;v private.playlist_versions;issues jsonb;pubissues jsonb:='[]';it record;ix integer;begin
 select * into p from public.playlists where id=p_id and creator_id=private.current_user_id() and kind='creator';if not found then raise exception using errcode='P0001',message='PLAYLIST_NOT_FOUND';end if;
 select * into strict d from private.playlist_drafts where playlist_id=p_id;
 select * into v from private.playlist_versions where id=p.current_version;
 issues:=private.playlist_readiness(d.content);
 if private.playlist_review_matches(d.review_id,p_id,d.draft_revision,d.content,d.checksum) and issues='[]'::jsonb then select * into r from private.playlist_reviews where id=d.review_id;end if;
 if p.is_published then
  for it in select i.*,s.is_published from private.playlist_version_items i join public.scenarios s on s.id=i.scenario_id where i.publication_id=p.current_version order by i.position loop
   if not private.scenario_publicly_available(it.scenario_id) or it.availability_generation<>private.current_scenario_availability_generation(it.scenario_id) then pubissues:=pubissues||private.creator_issue('items.'||it.position,'SCENARIO_UNAVAILABLE','A selected scenario became unavailable. Review and republish this playlist.');
   elsif not private.playlist_version_media_ready(it.scenario_version_id) then pubissues:=pubissues||private.creator_issue('items.'||it.position,'MEDIA_UNAVAILABLE','The selected recording is unavailable.');end if;
  end loop;
 end if;
 return jsonb_build_object('id',p.id,'revision',d.revision,'draft',jsonb_build_object('revision',d.draft_revision,'content',d.content,'savedAt',d.saved_at),
 'items',private.playlist_selection_details(d.content),'readiness',jsonb_build_object('issues',issues,'canReview',issues='[]'::jsonb),
 'review',case when r.id is null then null else jsonb_build_object('id',r.id,'draftRevision',r.draft_revision,'profileRevision',r.profile_revision,'reviewedAt',r.reviewed_at,'checklist',r.checklist) end,
 'publication',jsonb_build_object('state',case when p.current_version is null then 'never_published' when p.is_published then 'published' else 'withdrawn' end,
 'currentVersion',p.current_version,'publishedAt',p.published_at,'hasUnpublishedChanges',v.content is distinct from d.content or v.credit is distinct from jsonb_build_object('kind','creator','displayName',private.read_creator_profile()->>'displayName'),
 'availability',case when not p.is_published then null when private.playlist_publication_available(p.current_version) then 'available' else 'blocked' end,'issues',pubissues),'updatedAt',d.updated_at);
end $$;

create or replace function public.list_creator_playlist_scenarios(p_query text default '',p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator();q text:=private.playlist_query(p_query);filter jsonb;cur jsonb;rows jsonb;more boolean;next_at timestamptz;next_id text;begin
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 filter:=jsonb_build_object('query',q);cur:=private.playlist_cursor(p_cursor,'playlist-candidates',filter);
 with page as(select s.*,row_number() over(order by s.first_published_at desc,s.id desc) n from public.scenarios s join public.scenario_versions v on v.id=s.current_version
 where s.creator_id=actor and private.scenario_publicly_available(s.id) and not s.is_demo and private.playlist_item_preview(v.id) is not null
 and (q='' or private.playlist_candidate_matches(v.id,q))
 and(cur is null or(s.first_published_at,s.id)<((cur->>'at')::timestamptz,cur->>'id')) order by s.first_published_at desc,s.id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.playlist_item_preview(current_version) order by n) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit,max(first_published_at) filter(where n=p_limit),max(id) filter(where n=p_limit) into rows,more,next_at,next_id from page;
 return jsonb_build_object('scenarios',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','playlist-candidates','filter',filter,'at',next_at,'id',next_id)) else null end);
end $$;

create or replace function private.read_creator_snapshot(p_scenario_id text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare s public.scenarios; d private.scenario_drafts; r private.scenario_reviews; v public.scenario_versions; issues jsonb;
begin
  select * into s from public.scenarios where id=p_scenario_id and creator_id=private.current_user_id() and not is_demo;
  if not found then raise exception using errcode='P0001',message='SCENARIO_NOT_FOUND'; end if;
  select * into strict d from private.scenario_drafts where scenario_id=s.id;
  select * into r from private.scenario_reviews where id=d.review_id and scenario_id=s.id and draft_revision=d.draft_revision and checksum=d.checksum;
  select * into v from public.scenario_versions where id=s.current_version;
  issues:=private.validate_creator_draft(d.content,true);
  return jsonb_build_object('id',s.id,'revision',d.revision,
    'draft',jsonb_build_object('revision',d.draft_revision,'content',d.content,'savedAt',d.saved_at),
    'readiness',jsonb_build_object('issues',issues,'canReview',jsonb_array_length(issues)=0),
    'review',case when r.id is null then null else jsonb_build_object('id',r.id,'draftRevision',r.draft_revision,'reviewedAt',r.reviewed_at,'checklist',r.checklist) end,
    'publication',jsonb_build_object('state',case when s.current_version is null then 'never_published' when s.is_published then 'published' else 'withdrawn' end,
      'operatorVisibility',private.creator_visibility_notice(s.id),'currentVersion',v.content_version,'publishedAt',s.published_at,'hasUnpublishedChanges',v.checksum is distinct from d.checksum),
    'updatedAt',d.updated_at);
end $$;

create or replace function public.authorize_video_playback(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user(); aid uuid; a private.video_assets; d private.scenario_drafts; s public.training_sessions; i public.training_session_items; v public.scenario_versions; answered boolean; k text:=p_context->>'kind'; phase text:=p_context->>'phase'; begin
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

create or replace function private.video_can_read(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare a private.video_assets; actor uuid; begin
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

revoke create on schema public,private from wyp_moderation_rpc,wyp_playlist_fence;
commit;
