begin;
grant create on schema public,private to wyp_creator_rpc,wyp_rpc;
create function private.read_creator_profile() returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('displayName',display_name,'revision',revision) from private.creator_profiles where user_id=private.current_user_id()),'{"displayName":null,"revision":0}'::jsonb);
$$;
create function public.get_creator_profile() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.require_creator();return private.read_creator_profile();end $$;
create function public.save_creator_profile(p_request_id uuid,p_expected_revision integer,p_display_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator();n text:=private.normalize_creator_display_name(p_display_name);payload jsonb;r private.creator_profile_commands;oldrev integer;begin
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('expectedRevision',p_expected_revision,'displayName',n);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));
 select * into r from private.creator_profile_commands where actor_id=actor and request_id=p_request_id;
 if found then
  if r.payload<>payload or r.fingerprint<>md5(payload::text) then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';end if;
  return jsonb_build_object('profile',private.read_creator_profile(),'replayed',true);
 end if;
 select revision into oldrev from private.creator_profiles where user_id=actor for update;
 if coalesce(oldrev,0)<>p_expected_revision then raise exception using errcode='P0001',message='CREATOR_PROFILE_CONFLICT';end if;
 insert into private.creator_profiles(user_id,display_name,revision) values(actor,n,1) on conflict(user_id) do update set display_name=n,revision=private.creator_profiles.revision+1,updated_at=now();
 insert into private.creator_profile_commands values(actor,p_request_id,payload,md5(payload::text),coalesce(oldrev,0)+1);
 return jsonb_build_object('profile',private.read_creator_profile(),'replayed',false);
end $$;

create function private.lock_playlist_scenarios(p_content jsonb) returns void language plpgsql set search_path='' as $$
declare sid text;begin for sid in select distinct x->>'scenarioId' from jsonb_array_elements(p_content->'items') x order by 1 loop perform pg_advisory_xact_lock(hashtextextended('scenario:'||sid,2));end loop;end $$;
create function private.lock_playlist_draft(p_id uuid,p_revision integer) returns private.playlist_drafts language plpgsql set search_path='' as $$
declare d private.playlist_drafts;begin
 perform pg_advisory_xact_lock(hashtextextended('playlist:'||p_id::text,7));
 select draft.* into d from private.playlist_drafts draft join public.playlists p on p.id=draft.playlist_id where p.id=p_id and p.creator_id=private.current_user_id() for update of draft;
 if not found then raise exception using errcode='P0001',message='PLAYLIST_NOT_FOUND';end if;
 if p_revision is null or p_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 if d.revision<>p_revision then raise exception using errcode='P0001',message='PLAYLIST_CONFLICT';end if;return d;
end $$;
create function private.playlist_selection_details(p_content jsonb) returns jsonb language plpgsql stable set search_path='' as $$
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
   if not s.is_published then issues:=issues||private.creator_issue('items.'||i,'SCENARIO_UNAVAILABLE','This scenario is withdrawn. Restore it or remove it from the playlist.');
   else select content_version into cur from public.scenario_versions where id=s.current_version;end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('position',i,'selection',sel,'preview',pv,'currentVersion',cur,'issues',issues));i:=i+1;
 end loop;return rows;
end $$;
create function private.playlist_dependencies(p_content jsonb) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('scenarioId',v.scenario_id,'versionId',v.id,'generation',private.current_scenario_availability_generation(v.scenario_id)) order by n),'[]'::jsonb)
 from jsonb_array_elements(p_content->'items') with ordinality t(x,n) join public.scenario_versions v on v.scenario_id=x->>'scenarioId' and v.content_version=x->>'scenarioVersion';
$$;
create function private.playlist_readiness(p_content jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare issues jsonb:=private.validate_playlist_draft(p_content,true);profile jsonb:=private.read_creator_profile();row jsonb;begin
 if profile->'displayName'='null'::jsonb then issues:=issues||private.creator_issue('displayName','REQUIRED','Set a public creator name before review.');end if;
 if private.validate_playlist_draft(p_content,false)='[]'::jsonb then
  for row in select value from jsonb_array_elements(private.playlist_selection_details(p_content)) loop issues:=issues||(row->'issues');end loop;
 end if;return issues;
end $$;
create function private.playlist_review_matches(p_review uuid,p_playlist uuid,p_draft_revision integer,p_content jsonb,p_checksum text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.playlist_reviews r join private.creator_profiles p on p.user_id=private.current_user_id()
 where r.id=p_review and r.playlist_id=p_playlist and r.reviewer_id=private.current_user_id() and r.draft_revision=p_draft_revision and r.content=p_content and r.checksum=p_checksum and r.profile_revision=p.revision and r.credit=jsonb_build_object('kind','creator','displayName',p.display_name) and r.dependencies=private.playlist_dependencies(p_content));
$$;
create function private.playlist_publication_available(p_version uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.playlist_versions v join public.playlists p on p.id=v.playlist_id where v.id=p_version and p.is_published and p.current_version=v.id
 and (select count(*) from private.playlist_version_items i where i.publication_id=v.id) between 1 and 20
 and not exists(select 1 from private.playlist_version_items i left join public.scenarios s on s.id=i.scenario_id where i.publication_id=v.id and (s.id is null or not s.is_published or i.availability_generation<>private.current_scenario_availability_generation(i.scenario_id) or not private.playlist_version_media_ready(i.scenario_version_id))));
$$;
create function private.read_creator_playlist(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare p public.playlists;d private.playlist_drafts;r private.playlist_reviews;v private.playlist_versions;issues jsonb;pubissues jsonb:='[]';it record;ix integer;begin
 select * into p from public.playlists where id=p_id and creator_id=private.current_user_id() and kind='creator';if not found then raise exception using errcode='P0001',message='PLAYLIST_NOT_FOUND';end if;
 select * into strict d from private.playlist_drafts where playlist_id=p_id;
 select * into v from private.playlist_versions where id=p.current_version;
 issues:=private.playlist_readiness(d.content);
 if private.playlist_review_matches(d.review_id,p_id,d.draft_revision,d.content,d.checksum) and issues='[]'::jsonb then select * into r from private.playlist_reviews where id=d.review_id;end if;
 if p.is_published then
  for it in select i.*,s.is_published from private.playlist_version_items i join public.scenarios s on s.id=i.scenario_id where i.publication_id=p.current_version order by i.position loop
   if not it.is_published or it.availability_generation<>private.current_scenario_availability_generation(it.scenario_id) then pubissues:=pubissues||private.creator_issue('items.'||it.position,'SCENARIO_UNAVAILABLE','A selected scenario was withdrawn. Review and republish this playlist.');
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
create function private.creator_playlist_summary(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'title',snap->'draft'->'content'->>'title','revision',snap->'revision','draftRevision',snap->'draft'->'revision','itemCount',jsonb_array_length(snap->'draft'->'content'->'items'),'canReview',snap->'readiness'->'canReview','reviewed',snap->'review'<>'null'::jsonb,'publication',snap->'publication','createdAt',p.created_at,'updatedAt',snap->'updatedAt') from public.playlists p cross join lateral(select private.read_creator_playlist(p.id) snap) t where p.id=p_id and p.creator_id=private.current_user_id();
$$;
create function private.match_playlist_command(p_actor uuid,p_request uuid,p_operation text,p_payload jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare c private.playlist_commands;begin
 select * into c from private.playlist_commands where actor_id=p_actor and request_id=p_request;if not found then return null;end if;
 if c.operation<>p_operation or c.payload<>p_payload or c.fingerprint<>md5(p_payload::text) then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT';end if;
 return jsonb_build_object('playlist',private.read_creator_playlist(c.playlist_id),'replayed',true,'publishedVersion',c.published_version);
end $$;
create function private.record_playlist_command(p_actor uuid,p_request uuid,p_operation text,p_payload jsonb,p_id uuid,p_version uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare snap jsonb:=private.read_creator_playlist(p_id);begin
 insert into private.playlist_commands values(p_actor,p_request,p_operation,p_payload,md5(p_payload::text),p_id,(snap->>'revision')::integer,p_version);
 return jsonb_build_object('playlist',snap,'replayed',false,'publishedVersion',p_version);
end $$;
create function public.create_creator_playlist(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator();replay jsonb;pid uuid;content jsonb:='{"title":"","description":"","items":[]}';begin
 if p_request_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));replay:=private.match_playlist_command(actor,p_request_id,'create','{}');if replay is not null then return replay;end if;
 insert into public.playlists(creator_id,kind) values(actor,'creator') returning id into pid;
 insert into private.playlist_drafts(playlist_id,content,checksum) values(pid,content,md5(content::text));return private.record_playlist_command(actor,p_request_id,'create','{}',pid);
end $$;
create function public.get_creator_playlist(p_playlist_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin perform private.require_creator();return private.read_creator_playlist(p_playlist_id);end $$;
create function public.save_creator_playlist(p_playlist_id uuid,p_request_id uuid,p_expected_revision integer,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator();issues jsonb:=private.validate_playlist_draft(p_content,false);v_content jsonb;payload jsonb;replay jsonb;d private.playlist_drafts;sel jsonb;begin
 if p_request_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 if issues<>'[]'::jsonb then raise exception using errcode='P0001',message='INVALID_REQUEST',detail=jsonb_build_object('issues',issues)::text;end if;
 v_content:=private.normalize_playlist_content(p_content);payload:=jsonb_build_object('playlistId',p_playlist_id,'expectedRevision',p_expected_revision,'content',v_content);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));replay:=private.match_playlist_command(actor,p_request_id,'save',payload);if replay is not null then return replay;end if;
 d:=private.lock_playlist_draft(p_playlist_id,p_expected_revision);
 for sel in select value from jsonb_array_elements(v_content->'items') loop
  if not exists(select 1 from public.scenarios s join public.scenario_versions v on v.scenario_id=s.id where s.id=sel->>'scenarioId' and s.creator_id=actor and not s.is_demo and v.content_version=sel->>'scenarioVersion') then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 end loop;
 update private.playlist_drafts set content=v_content,checksum=md5(v_content::text),revision=revision+1,draft_revision=draft_revision+case when v_content is distinct from d.content then 1 else 0 end,
 review_id=case when v_content is distinct from d.content then null else review_id end,saved_at=now(),updated_at=now() where playlist_id=p_playlist_id;
 update public.playlists set updated_at=now() where id=p_playlist_id;
 return private.record_playlist_command(actor,p_request_id,'save',payload,p_playlist_id);
end $$;
create function public.get_creator_playlist_review_preview(p_playlist_id uuid,p_revision integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snap jsonb;profile jsonb;begin
 perform private.require_creator();snap:=private.read_creator_playlist(p_playlist_id);if p_revision is null or (snap->>'revision')::integer<>p_revision then raise exception using errcode='P0001',message='PLAYLIST_CONFLICT';end if;
 if not (snap->'readiness'->>'canReview')::boolean then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',snap->'readiness'->'issues')::text;end if;
 profile:=private.read_creator_profile();return jsonb_build_object('playlist',snap,'credit',jsonb_build_object('kind','creator','displayName',profile->>'displayName'),'profileRevision',profile->'revision','items',(select jsonb_agg(x->'preview' order by n) from jsonb_array_elements(snap->'items') with ordinality t(x,n)));
end $$;
create function public.review_creator_playlist(p_playlist_id uuid,p_request_id uuid,p_expected_revision integer,p_profile_revision integer,p_checklist jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator();payload jsonb;replay jsonb;d private.playlist_drafts;profile jsonb;issues jsonb;rid uuid;begin
 if p_request_id is null or p_profile_revision is null or p_profile_revision<0 or not private.creator_object(p_checklist,array['orderChecked','selectedVersionsChecked','mixedPlayersChecked','creditChecked']) or exists(select 1 from jsonb_each(p_checklist) where value is distinct from 'true'::jsonb) then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('playlistId',p_playlist_id,'expectedRevision',p_expected_revision,'profileRevision',p_profile_revision,'checklist',p_checklist);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));replay:=private.match_playlist_command(actor,p_request_id,'review',payload);if replay is not null then return replay;end if;
 d:=private.lock_playlist_draft(p_playlist_id,p_expected_revision);perform private.lock_playlist_scenarios(d.content);profile:=private.read_creator_profile();
 if (profile->>'revision')::integer<>p_profile_revision then raise exception using errcode='P0001',message='CREATOR_PROFILE_CONFLICT';end if;
 issues:=private.playlist_readiness(d.content);if issues<>'[]'::jsonb then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',issues)::text;end if;
 insert into private.playlist_reviews(playlist_id,reviewer_id,draft_revision,content,checksum,profile_revision,credit,checklist,dependencies) values(p_playlist_id,actor,d.draft_revision,d.content,d.checksum,p_profile_revision,jsonb_build_object('kind','creator','displayName',profile->>'displayName'),p_checklist,private.playlist_dependencies(d.content)) returning id into rid;
 update private.playlist_drafts set review_id=rid,revision=revision+1,updated_at=now() where playlist_id=p_playlist_id;
 return private.record_playlist_command(actor,p_request_id,'review',payload,p_playlist_id);
end $$;
create function public.publish_creator_playlist(p_playlist_id uuid,p_request_id uuid,p_expected_revision integer,p_review_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator();payload jsonb;replay jsonb;d private.playlist_drafts;r private.playlist_reviews;issues jsonb;vid uuid:=gen_random_uuid();seq integer;players jsonb;begin
 if p_request_id is null or p_review_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('playlistId',p_playlist_id,'expectedRevision',p_expected_revision,'reviewId',p_review_id);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));replay:=private.match_playlist_command(actor,p_request_id,'publish',payload);if replay is not null then return replay;end if;
 d:=private.lock_playlist_draft(p_playlist_id,p_expected_revision);perform private.lock_playlist_scenarios(d.content);
 issues:=private.playlist_readiness(d.content);if issues<>'[]'::jsonb then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',issues)::text;end if;
 if d.review_id is distinct from p_review_id or not private.playlist_review_matches(p_review_id,p_playlist_id,d.draft_revision,d.content,d.checksum) then raise exception using errcode='P0001',message='REVIEW_REQUIRED';end if;
 select * into strict r from private.playlist_reviews where id=p_review_id;
 select coalesce(max(sequence),0)+1 into seq from private.playlist_versions where playlist_id=p_playlist_id;
 select jsonb_agg(player order by position) into players from (select distinct on (x->'preview'->'player'->>'id') x->'preview'->'player' player,(x->>'position')::integer position from jsonb_array_elements(private.playlist_selection_details(d.content)) x order by x->'preview'->'player'->>'id',(x->>'position')::integer) t;
 insert into private.playlist_versions(id,playlist_id,sequence,title,description,credit,players,content,checksum,review_id) values(vid,p_playlist_id,seq,d.content->>'title',d.content->>'description',r.credit,players,d.content,d.checksum,r.id);
 insert into private.playlist_version_items(publication_id,position,scenario_version_id,scenario_id,availability_generation,preview)
 select vid,(n-1)::integer,v.id,v.scenario_id,private.current_scenario_availability_generation(v.scenario_id),private.playlist_item_preview(v.id) from jsonb_array_elements(d.content->'items') with ordinality t(x,n) join public.scenario_versions v on v.scenario_id=x->>'scenarioId' and v.content_version=x->>'scenarioVersion';
 insert into private.playlist_version_players(publication_id,player_id,display_name,position) select vid,(x->>'id')::uuid,x->>'displayName',(n-1)::integer from jsonb_array_elements(players) with ordinality t(x,n);
 update public.playlists set current_version=vid,is_published=true,first_published_at=coalesce(first_published_at,now()),published_at=now(),updated_at=now() where id=p_playlist_id;
 update private.playlist_drafts set revision=revision+1,updated_at=now() where playlist_id=p_playlist_id;
 return private.record_playlist_command(actor,p_request_id,'publish',payload,p_playlist_id,vid);
end $$;
create function public.unpublish_creator_playlist(p_playlist_id uuid,p_request_id uuid,p_expected_revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_creator();payload jsonb;replay jsonb;d private.playlist_drafts;begin
 if p_request_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 payload:=jsonb_build_object('playlistId',p_playlist_id,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(actor::text,1));replay:=private.match_playlist_command(actor,p_request_id,'unpublish',payload);if replay is not null then return replay;end if;
 d:=private.lock_playlist_draft(p_playlist_id,p_expected_revision);
 update public.playlists set is_published=false,updated_at=now() where id=p_playlist_id;
 update private.playlist_drafts set review_id=null,revision=revision+1,updated_at=now() where playlist_id=p_playlist_id;
 return private.record_playlist_command(actor,p_request_id,'unpublish',payload,p_playlist_id);
end $$;

-- Explicitly transfer only this milestone's functions, without exposing helpers.
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 n.nspname='private' and p.proname=any(array['read_creator_profile','lock_playlist_scenarios','lock_playlist_draft','playlist_selection_details','playlist_dependencies','playlist_readiness','playlist_review_matches','playlist_publication_available','read_creator_playlist','creator_playlist_summary','match_playlist_command','record_playlist_command'])
 or n.nspname='public' and p.proname=any(array['get_creator_profile','save_creator_profile','create_creator_playlist','get_creator_playlist','save_creator_playlist','get_creator_playlist_review_preview','review_creator_playlist','publish_creator_playlist','unpublish_creator_playlist']) loop
 execute format('alter function %s owner to wyp_creator_rpc',f.sig);execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.sig);end if;
 end loop;
end $$;
grant execute on function private.lock_playlist_scenarios(jsonb),private.playlist_publication_available(uuid) to wyp_rpc;
revoke create on schema public,private from wyp_creator_rpc,wyp_rpc;
commit;
