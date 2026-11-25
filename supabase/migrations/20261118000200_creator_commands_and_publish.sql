create function private.read_creator_snapshot(p_scenario_id text) returns jsonb
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
      'currentVersion',v.content_version,'publishedAt',s.published_at,'hasUnpublishedChanges',v.checksum is distinct from d.checksum),
    'updatedAt',d.updated_at);
end $$;
create function private.creator_summary(p_scenario_id text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare snapshot jsonb := private.read_creator_snapshot(p_scenario_id); created timestamptz;
begin
  select created_at into created from public.scenarios where id=p_scenario_id;
  return jsonb_build_object('id',snapshot->'id','title',snapshot->'draft'->'content'->'title','revision',snapshot->'revision',
    'draftRevision',snapshot->'draft'->'revision','canReview',snapshot->'readiness'->'canReview','reviewed',snapshot->'review'<>'null'::jsonb,
    'publication',snapshot->'publication','createdAt',created,'updatedAt',snapshot->'updatedAt');
end $$;
create function private.match_creator_command(p_actor uuid,p_request_id uuid,p_operation text,p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare command private.creator_commands;
begin
  select * into command from private.creator_commands where actor_id=p_actor and request_id=p_request_id;
  if not found then return null; end if;
  if command.operation<>p_operation or command.payload<>p_payload or command.fingerprint<>md5(p_payload::text) then raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('scenario',private.read_creator_snapshot(command.scenario_id),'replayed',true,'publishedVersion',command.published_version);
end $$;
create function private.record_creator_command(p_actor uuid,p_request_id uuid,p_operation text,p_payload jsonb,p_scenario_id text,p_version text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare snapshot jsonb:=private.read_creator_snapshot(p_scenario_id);
begin
  insert into private.creator_commands(actor_id,request_id,operation,payload,fingerprint,scenario_id,resulting_revision,published_version)
  values(p_actor,p_request_id,p_operation,p_payload,md5(p_payload::text),p_scenario_id,(snapshot->>'revision')::integer,p_version);
  return jsonb_build_object('scenario',snapshot,'replayed',false,'publishedVersion',p_version);
end $$;
create function private.lock_creator_draft(p_scenario_id text,p_revision integer) returns private.scenario_drafts
language plpgsql security invoker set search_path = '' as $$
declare d private.scenario_drafts;
begin
  if p_scenario_id is null or p_scenario_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_revision is null or p_revision<0 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('scenario:'||p_scenario_id,2));
  if not exists(select 1 from public.scenarios where id=p_scenario_id and creator_id=private.current_user_id() and not is_demo) then raise exception using errcode='P0001',message='SCENARIO_NOT_FOUND'; end if;
  select * into d from private.scenario_drafts where scenario_id=p_scenario_id for update;
  if not found then raise exception using errcode='P0001',message='SCENARIO_NOT_FOUND'; end if;
  if d.revision<>p_revision then raise exception using errcode='P0001',message='SCENARIO_CONFLICT'; end if;
  return d;
end $$;

create function private.project_creator_publication(p_scenario_id text,p_content_version text,p_content jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare source jsonb; challenge jsonb; key jsonb; vid text:=private.creator_youtube_id(p_content->'source'->>'url'); options jsonb; feedback jsonb; recommended jsonb;
begin
  source:=p_content->'source'||jsonb_build_object('kind','youtube','videoId',vid,'url','https://www.youtube.com/watch?v='||vid);
  if source->>'publishedDate'='' then source:=source-'publishedDate'; end if;
  if source->>'dateNote'='' then source:=source-'dateNote'; end if;
  select jsonb_agg(jsonb_build_object('id',o->'id','label',o->'label') order by n),
    jsonb_agg(jsonb_build_object('optionId',o->'id','assessment',o->'assessment','explanation',o->'explanation','acceptableWhen',o->'acceptableWhen','risks',o->'risks') order by n),
    coalesce(jsonb_agg(o->'id' order by n) filter(where o->>'assessment'='recommended'),'[]'::jsonb)
  into options,feedback,recommended from jsonb_array_elements(p_content->'options') with ordinality a(o,n);
  challenge:=jsonb_build_object('id',p_scenario_id,'contentVersion',p_content_version,'title',p_content->'title','topic',p_content->'topic','order',1,'mediaStatus','ready',
    'context',p_content->'context','question',p_content->'question','source',source,'knownFacts',p_content->'knownFacts','unknowns',p_content->'unknowns',
    'setup',jsonb_build_object('kind','youtube','videoId',vid,'startSeconds',p_content->'media'->'startSeconds','endSeconds',p_content->'media'->'decisionSeconds','alt',p_content->'media'->'setupAlt'),
    'decision',jsonb_build_object('kind','paused-video','atSeconds',p_content->'media'->'decisionSeconds','alt',p_content->'media'->'decisionAlt'),'options',options);
  key:=jsonb_build_object('recommendedOptionIds',recommended,'optionFeedback',feedback,'takeaway',p_content->'takeaway','outcomeText',p_content->'outcomeText',
    'observedAction',p_content->'observedAction','analysis',p_content->'analysis'||jsonb_build_object('notice',case when p_content->'analysis'->>'author'='ai-assisted' then 'AI-assisted interpretation reviewed by its creator; the player''s intent and missing context remain uncertain.' else 'Creator-authored interpretation; the player''s intent and missing context remain uncertain.' end),
    'reveal',jsonb_build_object('kind','youtube','videoId',vid,'startSeconds',p_content->'media'->'decisionSeconds','endSeconds',p_content->'media'->'endSeconds','alt',p_content->'media'->'revealAlt'));
  return jsonb_build_object('challenge',challenge,'answerKey',key);
end $$;

create function public.create_creator_scenario(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); replay jsonb; scenario_id text:=gen_random_uuid()::text; content jsonb:=private.empty_creator_draft();
begin
  if p_request_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'create','{}'); if replay is not null then return replay; end if;
  insert into public.scenarios(id,title,topic,sort_order,creator_id) values(scenario_id,'Untitled scenario','',1,actor);
  insert into private.scenario_drafts(scenario_id,content,checksum) values(scenario_id,content,private.creator_content_checksum(content));
  return private.record_creator_command(actor,p_request_id,'create','{}',scenario_id);
end $$;
create function public.get_creator_scenario(p_scenario_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin perform private.require_creator(); return private.read_creator_snapshot(p_scenario_id); end $$;

create function public.list_creator_scenarios(p_status text default 'all',p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); cur jsonb; cursor_at timestamptz; cursor_id text; rows jsonb; more boolean; next_at timestamptz; next_id text;
begin
  if p_status is null or p_status not in ('all','unpublished','published','withdrawn') or p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  if p_cursor is not null then
    begin
      if length(p_cursor)>1024 then raise invalid_parameter_value; end if;
      cur:=private.decode_creator_cursor(p_cursor);
      if not private.creator_object(cur,array['createdAt','id','status']) or cur->>'status' is distinct from p_status or not private.creator_text(cur->'createdAt',50) or not private.creator_text(cur->'id',36) or cur->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or cur->>'createdAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise invalid_parameter_value; end if;
      cursor_at:=(cur->>'createdAt')::timestamptz; cursor_id:=lower(cur->>'id');
    exception when others then raise exception using errcode='P0001',message='INVALID_REQUEST'; end;
  end if;
  with page as (
    select s.*,row_number() over(order by s.created_at desc,s.id desc) n from public.scenarios s
    where creator_id=actor and not is_demo and (p_cursor is null or (s.created_at,s.id)<(cursor_at,cursor_id))
      and (p_status='all' or p_status='unpublished' and current_version is null or p_status='published' and is_published or p_status='withdrawn' and current_version is not null and not is_published)
    order by s.created_at desc,s.id desc limit p_limit+1
  ) select coalesce(jsonb_agg(private.creator_summary(id) order by n) filter(where n<=p_limit),'[]'),count(*)>p_limit,
      max(created_at) filter(where n=p_limit),max(id) filter(where n=p_limit) into rows,more,next_at,next_id from page;
  return jsonb_build_object('scenarios',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('createdAt',next_at,'id',next_id,'status',p_status)) else null end);
end $$;

create function public.save_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_content jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; replay jsonb; payload jsonb; issues jsonb; v_content jsonb:=p_content; vid text;
begin
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

create function public.get_creator_review_preview(p_scenario_id text,p_revision integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare snapshot jsonb; projected jsonb; content jsonb; version text; answers jsonb;
begin
  perform private.require_creator(); snapshot:=private.read_creator_snapshot(p_scenario_id);
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

create function public.review_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_checklist jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; replay jsonb; payload jsonb; issues jsonb; v_review_id uuid;
begin
  if p_request_id is null or not private.creator_object(p_checklist,array['povInformationChecked','setupSpoilersChecked','pauseTimingChecked','continuationChecked','normalSpeedAudioChecked','alternativeChoicesChecked','sourceAttributionChecked']) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  if exists(select 1 from jsonb_each(p_checklist) x where x.value is distinct from 'true'::jsonb) then raise exception using errcode='P0001',message='REVIEW_REQUIRED'; end if;
  payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision,'checklist',p_checklist);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'review',payload); if replay is not null then return replay; end if;
  d:=private.lock_creator_draft(p_scenario_id,p_expected_revision);
  issues:=private.validate_creator_draft(d.content,true);
  if jsonb_array_length(issues)>0 then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',issues)::text; end if;
  insert into private.scenario_reviews(scenario_id,draft_revision,checksum,reviewer_id,checklist)
    values(p_scenario_id,d.draft_revision,d.checksum,actor,p_checklist) returning id into v_review_id;
  update private.scenario_drafts set review_id=v_review_id,revision=revision+1,updated_at=now() where scenario_id=p_scenario_id;
  return private.record_creator_command(actor,p_request_id,'review',payload,p_scenario_id);
end $$;

create function public.publish_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_review_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; r private.scenario_reviews; v public.scenario_versions;
  replay jsonb; payload jsonb; issues jsonb; projected jsonb; version_no integer; version_id uuid; version_name text;
begin
  if p_request_id is null or p_review_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision,'reviewId',p_review_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'publish',payload); if replay is not null then return replay; end if;
  d:=private.lock_creator_draft(p_scenario_id,p_expected_revision);
  select * into r from private.scenario_reviews where id=p_review_id and id=d.review_id and scenario_id=p_scenario_id and reviewer_id=actor and draft_revision=d.draft_revision and checksum=d.checksum;
  if not found then raise exception using errcode='P0001',message='REVIEW_REQUIRED'; end if;
  issues:=private.validate_creator_draft(d.content,true);
  if jsonb_array_length(issues)>0 then raise exception using errcode='P0001',message='DRAFT_NOT_READY',detail=jsonb_build_object('issues',issues)::text; end if;
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

create function public.unpublish_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=private.require_creator(); d private.scenario_drafts; replay jsonb; payload jsonb;
begin
  if p_request_id is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  payload:=jsonb_build_object('scenarioId',p_scenario_id,'expectedRevision',p_expected_revision);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,1));
  replay:=private.match_creator_command(actor,p_request_id,'unpublish',payload); if replay is not null then return replay; end if;
  d:=private.lock_creator_draft(p_scenario_id,p_expected_revision);
  if not exists(select 1 from public.scenarios where id=p_scenario_id and current_version is not null) then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
  update public.scenarios set is_published=false,updated_at=now() where id=p_scenario_id;
  update private.scenario_drafts set review_id=null,revision=revision+1,updated_at=now() where scenario_id=p_scenario_id;
  return private.record_creator_command(actor,p_request_id,'unpublish',payload,p_scenario_id);
end $$;
