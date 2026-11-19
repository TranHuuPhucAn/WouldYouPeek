-- Additive authoring schema. Published versions and existing learner data stay frozen.
alter default privileges revoke execute on functions from public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'wyp_creator_rpc') then
    create role wyp_creator_rpc nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (select 1 from pg_roles where rolname = 'wyp_creator_rpc' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Existing creator role has unsafe attributes';
  end if;
end $$;
grant wyp_creator_rpc to postgres with set true;
grant usage on schema public, private to wyp_creator_rpc;
grant create on schema public, private to wyp_creator_rpc, wyp_rpc;

alter table public.scenarios
  add column creator_id uuid references auth.users(id) on delete set null,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column first_published_at timestamptz,
  add column published_at timestamptz;
create index creator_scenarios_owner_created on public.scenarios(creator_id, created_at desc, id desc);
create index creator_library_publication on public.scenarios(first_published_at desc, id desc) where is_published and not is_demo and creator_id is not null;

create table private.scenario_drafts (
  scenario_id text primary key references public.scenarios(id),
  revision integer not null default 0 check (revision >= 0),
  draft_revision integer not null default 0 check (draft_revision >= 0 and draft_revision <= revision),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 65536),
  checksum text not null,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  review_id uuid
);
create table private.scenario_reviews (
  id uuid primary key default gen_random_uuid(),
  scenario_id text not null references public.scenarios(id),
  draft_revision integer not null check (draft_revision >= 0),
  checksum text not null,
  reviewer_id uuid not null,
  reviewed_at timestamptz not null default now(),
  checklist jsonb not null,
  unique (id, scenario_id)
);
alter table private.scenario_drafts add constraint current_review_belongs_to_scenario
  foreign key (review_id, scenario_id) references private.scenario_reviews(id, scenario_id);
create table private.creator_commands (
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation in ('create','save','review','publish','unpublish')),
  payload jsonb not null,
  fingerprint text not null,
  scenario_id text not null references public.scenarios(id),
  resulting_revision integer not null check (resulting_revision >= 0),
  published_version text,
  created_at timestamptz not null default now(),
  primary key(actor_id, request_id)
);
create trigger immutable_creator_review before update or delete on private.scenario_reviews for each row execute function private.reject_immutable_change();
create trigger immutable_creator_command before update on private.creator_commands for each row execute function private.reject_immutable_change();
alter table private.scenario_drafts enable row level security;
alter table private.scenario_drafts force row level security;
alter table private.scenario_reviews enable row level security;
alter table private.scenario_reviews force row level security;
alter table private.creator_commands enable row level security;
alter table private.creator_commands force row level security;
revoke all on private.scenario_drafts, private.scenario_reviews, private.creator_commands from public, anon, authenticated;

create function private.creator_allowed() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = private.current_user_id() and role = 'creator' and email_verified_at is not null);
$$;
create function private.require_creator() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := private.require_verified_user();
begin
  if not private.creator_allowed() then raise exception using errcode='P0001', message='CREATOR_REQUIRED'; end if;
  return v_user;
end $$;
create function private.creator_object(p_value jsonb, p_keys text[]) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'object' then
    not exists (select 1 from jsonb_object_keys(p_value) k where not (k = any(p_keys)))
    and p_value ?& p_keys else false end;
$$;
create function private.creator_text(p_value jsonb, p_limit integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= p_limit, false);
$$;
create function private.creator_text_list(p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  return jsonb_array_length(p_value) <= 10 and not exists (select 1 from jsonb_array_elements(p_value) x where not private.creator_text(x,300));
end $$;
create function private.creator_number(p_value jsonb, p_max numeric, p_precision integer) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if p_value = 'null'::jsonb then return true; end if;
  if jsonb_typeof(p_value) is distinct from 'number' then return false; end if;
  n := (p_value #>> '{}')::numeric;
  return n >= 0 and n <= p_max and n = round(n,p_precision);
end $$;
create function private.creator_issue(p_path text, p_code text, p_message text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_array(jsonb_build_object('path',p_path,'code',p_code,'message',p_message));
$$;
create function private.creator_trim(p_value text) returns text
language sql immutable set search_path = '' as $$
  select btrim(p_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
create function private.creator_youtube_id(p_url text) returns text
language plpgsql immutable set search_path = '' as $$
declare m text[]; q text; ids text[]; clean text:=private.creator_trim(p_url);
begin
  if clean is null or length(clean)>2048 or clean ~ U&'[\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF]' then return null; end if;
  q:=split_part(split_part(clean,'#',1),'?',2);
  -- Percent-encoded parameter names must not disguise a second video selection.
  if q ~* '(^|&)%76(?:=|&|$)' then return null; end if;
  select array_agg(case when x='v' then '' else substring(x from 3) end) into ids
    from unnest(string_to_array(q,'&')) x where x='v' or x like 'v=%';
  m:=regexp_match(clean,'^https://youtu\.be/([A-Za-z0-9_-]{11})(?:\?[^#]*)?(?:#.*)?$');
  if m is not null then
    if coalesce(cardinality(ids),0)>1 or cardinality(ids)=1 and ids[1]<>m[1] then return null; end if;
    return m[1];
  end if;
  m:=regexp_match(clean,'^https://(?:www\.|m\.)?youtube\.com/watch\?([^#]*)(?:#.*)?$');
  if m is null or cardinality(ids) is distinct from 1 or ids[1] !~ '^[A-Za-z0-9_-]{11}$' then return null; end if;
  return ids[1];
end $$;
create function private.creator_content_checksum(p_content jsonb) returns text
language sql immutable set search_path = '' as $$ select md5(p_content::text); $$;

-- Mirrors the documented client normalization; immutable command payloads use this form.
create function private.normalize_creator_value(p_value jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare result jsonb;
begin
  case jsonb_typeof(p_value)
    when 'string' then return to_jsonb(private.creator_trim(p_value #>> '{}'));
    when 'array' then
      select coalesce(jsonb_agg(x.v order by x.n) filter(where x.v<>'""'::jsonb),'[]') into result
      from (select private.normalize_creator_value(value) v,ordinality n from jsonb_array_elements(p_value) with ordinality) x;
      return result;
    when 'object' then
      select jsonb_object_agg(key,private.normalize_creator_value(value)) into result from jsonb_each(p_value);
      return coalesce(result,'{}');
    else return p_value;
  end case;
end $$;
create function private.normalize_creator_content(p_content jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare result jsonb:=private.normalize_creator_value(p_content); vid text;
begin
  vid:=private.creator_youtube_id(result->'source'->>'url');
  if vid is not null then result:=jsonb_set(result,'{source,url}',to_jsonb('https://www.youtube.com/watch?v='||vid)); end if;
  return result;
end $$;
create function private.encode_creator_cursor(p_cursor jsonb) returns text
language sql immutable set search_path = '' as $$
 select rtrim(translate(replace(encode(convert_to(p_cursor::text,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=');
$$;
create function private.decode_creator_cursor(p_cursor text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare result jsonb; raw text;
begin
  if p_cursor is null or length(p_cursor)>1024 or p_cursor !~ '^[A-Za-z0-9_-]+$' or length(p_cursor)%4=1 then raise invalid_parameter_value; end if;
  raw:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'UTF8');
  if rtrim(translate(replace(encode(convert_to(raw,'UTF8'),'base64'),E'\n',''),'+/','-_'),'=')<>p_cursor then raise invalid_parameter_value; end if;
  result:=raw::jsonb;
  return result;
exception when others then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;

create function private.empty_creator_draft() returns jsonb
language sql immutable set search_path = '' as $$
 select '{"title":"","topic":"","context":"","question":"","source":{"url":"","title":"","uploader":"","player":"","map":"","agent":"","score":"","matchType":null,"round":null,"side":null,"publishedDate":"","dateNote":""},"media":{"startSeconds":null,"decisionSeconds":null,"endSeconds":null,"setupAlt":"","decisionAlt":"","revealAlt":""},"knownFacts":[],"unknowns":[],"options":[],"observedAction":{"optionId":null,"description":""},"analysis":{"author":"creator","rationale":"","limitations":[]},"takeaway":"","outcomeText":""}'::jsonb;
$$;

create function private.validate_creator_draft(p_content jsonb, p_publish boolean default false) returns jsonb
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
