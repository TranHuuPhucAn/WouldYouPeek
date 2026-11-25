-- Keep old YouTube serialization and review checksums identical.
grant create on schema public,private to wyp_creator_rpc,wyp_video_rpc;
create function private.validate_creator_draft_youtube_v4(p_content jsonb, p_publish boolean default false) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare issues jsonb := '[]'; k text; lim integer; opt jsonb; idx integer := 0; ids text[] := '{}'; t numeric; d numeric; e numeric; source_date date;
begin
  if p_content is null or octet_length(p_content::text)>65536 or not private.creator_object(p_content,array['title','topic','context','question','source','media','knownFacts','unknowns','options','observedAction','analysis','takeaway','outcomeText']) then
    return private.creator_issue('content','INVALID_SHAPE','Use only the supported draft fields within the size limit.');
  end if;
  foreach k in array array['title','topic','context','question','takeaway','outcomeText'] loop
    lim := case k when 'title' then 120 when 'topic' then 80 when 'context' then 4000 else 2000 end;
    if not private.creator_text(p_content->k,lim) then issues:=issues||private.creator_issue(k,'INVALID_TEXT','Enter text within the field limit.'); end if;
  end loop;
  if not private.creator_object(p_content->'source',array['url','title','uploader','player','map','agent','score','matchType','round','side','publishedDate','dateNote']) then
    issues:=issues||private.creator_issue('source','INVALID_SHAPE','Use the supported source fields.');
  else
    foreach k in array array['url','title','uploader','player','map','agent','score','publishedDate','dateNote'] loop
      lim := case when k='url' then 2048 else 300 end;
      if not private.creator_text(p_content->'source'->k,lim) then issues:=issues||private.creator_issue('source.'||k,'INVALID_TEXT','Enter text within the field limit.'); end if;
    end loop;
    if not (p_content->'source'->'matchType' = 'null'::jsonb or p_content->'source'->>'matchType' in ('ranked','tournament')) then issues:=issues||private.creator_issue('source.matchType','INVALID_VALUE','Choose ranked or tournament.'); end if;
    if not (p_content->'source'->'side' = 'null'::jsonb or p_content->'source'->>'side' in ('attack','defense')) then issues:=issues||private.creator_issue('source.side','INVALID_VALUE','Choose attack or defense.'); end if;
    if not private.creator_number(p_content->'source'->'round',100,0) or p_content->'source'->'round' = '0'::jsonb then issues:=issues||private.creator_issue('source.round','INVALID_VALUE','Round must be a whole number from 1 to 100.'); end if;
  end if;
  if not private.creator_object(p_content->'media',array['startSeconds','decisionSeconds','endSeconds','setupAlt','decisionAlt','revealAlt']) then
    issues:=issues||private.creator_issue('media','INVALID_SHAPE','Use the supported timing fields.');
  else
    foreach k in array array['startSeconds','decisionSeconds','endSeconds'] loop
      if not private.creator_number(p_content->'media'->k,43200,3) then issues:=issues||private.creator_issue('media.'||k,'INVALID_VALUE','Use seconds from 0 to 43200 with at most three decimal places.'); end if;
    end loop;
    foreach k in array array['setupAlt','decisionAlt','revealAlt'] loop
      if not private.creator_text(p_content->'media'->k,300) then issues:=issues||private.creator_issue('media.'||k,'INVALID_TEXT','Enter alt text within 300 characters.'); end if;
    end loop;
  end if;
  foreach k in array array['knownFacts','unknowns'] loop
    if not private.creator_text_list(p_content->k) then issues:=issues||private.creator_issue(k,'INVALID_LIST','Use at most ten nonblank entries of 300 characters.'); end if;
  end loop;
  if not private.creator_object(p_content->'analysis',array['author','rationale','limitations']) then
    issues:=issues||private.creator_issue('analysis','INVALID_SHAPE','Use the supported analysis fields.');
  else
    if p_content->'analysis'->>'author' not in ('creator','ai-assisted') or jsonb_typeof(p_content->'analysis'->'author') is distinct from 'string' then issues:=issues||private.creator_issue('analysis.author','INVALID_VALUE','Declare creator or AI-assisted authorship.'); end if;
    if not private.creator_text(p_content->'analysis'->'rationale',4000) then issues:=issues||private.creator_issue('analysis.rationale','INVALID_TEXT','Enter a rationale within 4000 characters.'); end if;
    if not private.creator_text_list(p_content->'analysis'->'limitations') then issues:=issues||private.creator_issue('analysis.limitations','INVALID_LIST','Use at most ten short limitations.'); end if;
  end if;
  if not private.creator_object(p_content->'observedAction',array['optionId','description']) then
    issues:=issues||private.creator_issue('observedAction','INVALID_SHAPE','Use the supported observed-action fields.');
  else
    if not private.creator_text(p_content->'observedAction'->'description',2000) then issues:=issues||private.creator_issue('observedAction.description','INVALID_TEXT','Enter the observed action within 2000 characters.'); end if;
    if p_content->'observedAction'->'optionId' <> 'null'::jsonb and (jsonb_typeof(p_content->'observedAction'->'optionId') is distinct from 'string' or p_content->'observedAction'->>'optionId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then issues:=issues||private.creator_issue('observedAction.optionId','INVALID_VALUE','Choose a valid option identifier.'); end if;
  end if;
  if jsonb_typeof(p_content->'options') is distinct from 'array' then issues:=issues||private.creator_issue('options','INVALID_LIST','Use an options list.');
  elsif jsonb_array_length(p_content->'options')>5 then issues:=issues||private.creator_issue('options','TOO_MANY','Use at most five options.');
  else
    for opt in select value from jsonb_array_elements(p_content->'options') loop
      if not private.creator_object(opt,array['id','label','assessment','explanation','acceptableWhen','risks']) then issues:=issues||private.creator_issue('options.'||idx,'INVALID_SHAPE','Use the supported option fields.');
      else
        if jsonb_typeof(opt->'id') is distinct from 'string' or opt->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or lower(opt->>'id')=any(ids) then issues:=issues||private.creator_issue('options.'||idx||'.id','INVALID_VALUE','Every option needs a unique UUID.'); end if;
        ids:=array_append(ids,lower(opt->>'id'));
        if not private.creator_text(opt->'label',160) then issues:=issues||private.creator_issue('options.'||idx||'.label','INVALID_TEXT','Enter a label within 160 characters.'); end if;
        if not (opt->'assessment'='null'::jsonb or opt->>'assessment' in ('recommended','reasonable','risky')) then issues:=issues||private.creator_issue('options.'||idx||'.assessment','INVALID_VALUE','Choose a supported assessment.'); end if;
        if not private.creator_text(opt->'explanation',4000) then issues:=issues||private.creator_issue('options.'||idx||'.explanation','INVALID_TEXT','Enter an explanation within 4000 characters.'); end if;
        foreach k in array array['acceptableWhen','risks'] loop
          if not private.creator_text_list(opt->k) then issues:=issues||private.creator_issue('options.'||idx||'.'||k,'INVALID_LIST','Use at most ten short entries.'); end if;
        end loop;
      end if;
      idx:=idx+1;
    end loop;
  end if;
  if jsonb_array_length(issues)>0 or not p_publish then return issues; end if;
  if not exists(select 1 from jsonb_array_elements_text(p_content->'knownFacts') fact where private.creator_trim(fact)<>'') then
    issues:=issues||private.creator_issue('knownFacts','REQUIRED','Include at least one player-visible fact.');
  end if;
  foreach k in array array['title','topic','context','question','takeaway','outcomeText'] loop
    if private.creator_trim(p_content->>k)='' then issues:=issues||private.creator_issue(k,'REQUIRED','Complete this field before review.'); end if;
  end loop;
  foreach k in array array['title','uploader','player','map','agent','score'] loop
    if private.creator_trim(p_content->'source'->>k)='' then issues:=issues||private.creator_issue('source.'||k,'REQUIRED','Complete the source attribution.'); end if;
  end loop;
  if private.creator_youtube_id(p_content->'source'->>'url') is null then issues:=issues||private.creator_issue('source.url','INVALID_SOURCE','Use a YouTube watch or short video URL.'); end if;
  foreach k in array array['round','matchType','side'] loop
    if p_content->'source'->k='null'::jsonb then issues:=issues||private.creator_issue('source.'||k,'REQUIRED','Complete this source field.'); end if;
  end loop;
  if private.creator_trim(p_content->'source'->>'score') !~ '^[0-9]{1,2}[-:][0-9]{1,2}$' then issues:=issues||private.creator_issue('source.score','INVALID_VALUE','Use a score such as 6-5.'); end if;
  if p_content->'source'->>'publishedDate'<>'' then
    begin
      source_date:=(p_content->'source'->>'publishedDate')::date;
      if to_char(source_date,'YYYY-MM-DD')<>p_content->'source'->>'publishedDate' then raise invalid_datetime_format; end if;
    exception when others then issues:=issues||private.creator_issue('source.publishedDate','INVALID_DATE','Use a valid YYYY-MM-DD date.'); end;
  end if;
  t:=(p_content->'media'->>'startSeconds')::numeric; d:=(p_content->'media'->>'decisionSeconds')::numeric; e:=(p_content->'media'->>'endSeconds')::numeric;
  foreach k in array array['startSeconds','decisionSeconds','endSeconds'] loop
    if p_content->'media'->k='null'::jsonb then issues:=issues||private.creator_issue('media.'||k,'REQUIRED','Complete this timing before review.'); end if;
  end loop;
  if t is not null and d is not null and e is not null then
    if d-t<2 or d-t>120 then issues:=issues||private.creator_issue('media.decisionSeconds','SETUP_DURATION','Setup must last between 2 and 120 seconds.'); end if;
    if e-d<1 or e-d>120 then issues:=issues||private.creator_issue('media.endSeconds','CONTINUATION_DURATION','Continuation must last between 1 and 120 seconds.'); end if;
  end if;
  foreach k in array array['setupAlt','decisionAlt','revealAlt'] loop
    if private.creator_trim(p_content->'media'->>k)='' then issues:=issues||private.creator_issue('media.'||k,'REQUIRED','Describe this segment.'); end if;
  end loop;
  if jsonb_array_length(p_content->'options')<2 then issues:=issues||private.creator_issue('options','TOO_FEW','Include at least two options.'); end if;
  idx:=0;
  for opt in select value from jsonb_array_elements(p_content->'options') loop
    foreach k in array array['label','explanation'] loop
      if private.creator_trim(opt->>k)='' then issues:=issues||private.creator_issue('options.'||idx||'.'||k,'REQUIRED','Complete this option field.'); end if;
    end loop;
    if opt->'assessment'='null'::jsonb then issues:=issues||private.creator_issue('options.'||idx||'.assessment','REQUIRED','Assess this option independently.'); end if;
    idx:=idx+1;
  end loop;
  if not exists(select 1 from jsonb_array_elements(p_content->'options') o where o->>'id'=p_content->'observedAction'->>'optionId') then issues:=issues||private.creator_issue('observedAction.optionId','REQUIRED','Select the observed choice.'); end if;
  if private.creator_trim(p_content->'observedAction'->>'description')='' then issues:=issues||private.creator_issue('observedAction.description','REQUIRED','Describe what was observed.'); end if;
  if private.creator_trim(p_content->'analysis'->>'rationale')='' then issues:=issues||private.creator_issue('analysis.rationale','REQUIRED','Explain the reasoning and assumptions.'); end if;
  return issues;
end $$;

create function private.project_creator_publication_youtube_v4(p_scenario_id text,p_content_version text,p_content jsonb) returns jsonb
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

create or replace function private.validate_creator_draft(p_content jsonb,p_publish boolean default false) returns jsonb
language plpgsql immutable set search_path='' as $$
declare source jsonb:=p_content->'source'; adapted jsonb; issues jsonb:='[]'; credit text; begin
 if source->>'kind' is distinct from 'uploaded' then return private.validate_creator_draft_youtube_v4(p_content,p_publish); end if;
 if not private.creator_object(source,array['kind','assetId','creditUrl','title','uploader','player','map','agent','score','matchType','round','side','publishedDate','dateNote']) then return private.creator_issue('source','INVALID_SHAPE','Use the supported uploaded source fields.'); end if;
 if source->'assetId'<>'null'::jsonb and (jsonb_typeof(source->'assetId') is distinct from 'string' or source->>'assetId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then issues:=issues||private.creator_issue('source.assetId','INVALID_VALUE','Choose an uploaded video.'); end if;
 credit:=source->>'creditUrl';
 if not private.creator_text(source->'creditUrl',2048) or credit<>'' and (credit !~ '^https://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$' or credit ~ '[[:cntrl:]]') then issues:=issues||private.creator_issue('source.creditUrl','INVALID_VALUE','Use an HTTPS credit link or leave it empty.'); end if;
 if p_publish and source->'assetId'='null'::jsonb then issues:=issues||private.creator_issue('source.assetId','REQUIRED','Choose a ready uploaded video.'); end if;
 -- Reuse common field validation with an internal URL sentinel. It is never stored,
 -- fetched, or emitted; uploaded source identity is always the immutable asset ID.
 adapted:=jsonb_set(p_content,'{source}',(source-'kind'-'assetId'-'creditUrl')||jsonb_build_object('url','https://www.youtube.com/watch?v=00000000000'));
 return issues||private.validate_creator_draft_youtube_v4(adapted,p_publish);
end $$;
create or replace function private.project_creator_publication(p_scenario_id text,p_content_version text,p_content jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; adapted jsonb; source jsonb:=p_content->'source'; begin
 if source->>'kind' is distinct from 'uploaded' then return private.project_creator_publication_youtube_v4(p_scenario_id,p_content_version,p_content); end if;
 adapted:=jsonb_set(p_content,'{source}',(source-'kind'-'assetId'-'creditUrl')||jsonb_build_object('url','https://www.youtube.com/watch?v=00000000000'));
 result:=private.project_creator_publication_youtube_v4(p_scenario_id,p_content_version,adapted);
 if source->>'publishedDate'='' then source:=source-'publishedDate'; end if;
 if source->>'dateNote'='' then source:=source-'dateNote'; end if;
 result:=jsonb_set(result,'{challenge,source}',source);
 result:=jsonb_set(result,'{challenge,setup}',((result->'challenge'->'setup')-'videoId')||jsonb_build_object('kind','uploaded-video','assetId',source->'assetId'));
 result:=jsonb_set(result,'{answerKey,reveal}',((result->'answerKey'->'reveal')-'videoId')||jsonb_build_object('kind','uploaded-video','assetId',source->'assetId'));
 return result;
end $$;

-- Authoring locks the referenced asset, serializing source attachment/publication
-- with deletion. Published references are immutable and keep old sessions playable.
create function private.assert_creator_video_source(p_content jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a private.video_assets; aid uuid; stop numeric; begin
 if p_content->'source'->>'kind' is distinct from 'uploaded' or p_content->'source'->'assetId'='null'::jsonb then return; end if;
 aid:=(p_content->'source'->>'assetId')::uuid;
 select * into a from private.video_assets where id=aid and owner_id=private.current_user_id() for update;
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 if a.state<>'ready' or not exists(select 1 from storage.objects o where o.bucket_id=a.bucket and o.name=a.object_path and o.id::text||':'||coalesce(o.version,'')=a.object_version and (o.metadata->>'size')::bigint=a.byte_size) then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
 stop:=(p_content->'media'->>'endSeconds')::numeric;
 if stop is not null and stop>(a.metadata->>'durationSeconds')::numeric then raise exception using errcode='P0001',message='INVALID_REQUEST',detail='{"issues":[{"path":"media.endSeconds","code":"DURATION","message":"The continuation cannot exceed the uploaded video duration."}]}'; end if;
end $$;
create function private.sync_draft_video_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare aid uuid; begin
 perform private.assert_creator_video_source(new.content);
 if new.content->'source'->>'kind'='uploaded' and new.content->'source'->'assetId'<>'null'::jsonb then
  aid:=(new.content->'source'->>'assetId')::uuid;
  insert into private.scenario_draft_assets(scenario_id,asset_id) values(new.scenario_id,aid) on conflict(scenario_id) do update set asset_id=excluded.asset_id;
 else delete from private.scenario_draft_assets where scenario_id=new.scenario_id;
 end if;
 return new;
end $$;
create trigger draft_video_reference after insert or update of content on private.scenario_drafts for each row execute function private.sync_draft_video_reference();
create function private.record_version_video_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare aid uuid; a private.video_assets; begin
 if new.challenge->'source'->>'kind'='uploaded' then
  aid:=(new.challenge->'source'->>'assetId')::uuid;
  select * into a from private.video_assets where id=aid and owner_id=private.current_user_id() and state='ready' for update;
  if not found then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
  insert into private.scenario_version_assets(version_id,asset_id) values(new.id,aid);
 end if;
 return new;
end $$;
create trigger version_video_reference after insert on public.scenario_versions for each row execute function private.record_version_video_reference();

create or replace function public.review_creator_scenario(p_scenario_id text,p_request_id uuid,p_expected_revision integer,p_checklist jsonb) returns jsonb
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

alter function private.validate_creator_draft_youtube_v4(jsonb,boolean) owner to wyp_creator_rpc;
alter function private.project_creator_publication_youtube_v4(text,text,jsonb) owner to wyp_creator_rpc;
alter function private.assert_creator_video_source(jsonb) owner to wyp_video_rpc;
alter function private.sync_draft_video_reference() owner to wyp_video_rpc;
alter function private.record_version_video_reference() owner to wyp_video_rpc;
revoke all on function private.validate_creator_draft_youtube_v4(jsonb,boolean),private.project_creator_publication_youtube_v4(text,text,jsonb),private.assert_creator_video_source(jsonb),private.sync_draft_video_reference(),private.record_version_video_reference() from public,anon,authenticated,wyp_media_validator;
grant execute on function private.assert_creator_video_source(jsonb) to wyp_creator_rpc;
revoke create on schema public,private from wyp_creator_rpc,wyp_video_rpc;
