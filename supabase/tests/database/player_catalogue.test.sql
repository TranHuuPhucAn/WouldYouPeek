begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok(not (select rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls from pg_roles where rolname='wyp_player_registry'),'registry role has no elevated flags');
select is((select count(*)::integer from pg_tables where tableowner='wyp_player_registry'),0,'registry role owns no tables');
select ok(not has_schema_privilege('wyp_player_registry','public','CREATE'),'registry cannot create public objects');
select ok(not has_table_privilege('wyp_player_registry','private.scenario_answer_keys','SELECT'),'registry cannot read answers');
select ok(not has_table_privilege('anon','public.players','SELECT'),'guest has no raw player-table access');
select ok(not has_table_privilege('authenticated','private.scenario_version_players','INSERT'),'clients cannot assign player identity');
select ok(not has_function_privilege('anon','private.resolve_player(text)','EXECUTE'),'guest cannot call the identity resolver');
select ok(not has_function_privilege('authenticated','private.resolve_player(text)','EXECUTE'),'creator cannot directly call the identity resolver');
select ok(not has_function_privilege('anon','public.get_active_training_session()','EXECUTE'),'active-session summary is not a guest RPC');
select ok(has_function_privilege('anon','public.list_library_players(text,text,integer)','EXECUTE'),'guest may browse safe grouped metadata');
select ok(not exists(select 1 from pg_proc where proowner='wyp_player_registry'::regrole and (proconfig is null or not ('search_path=""'=any(proconfig)))),'registry helpers pin an empty search path');
select is(private.normalize_player_display_name(U&'\0020\FF34\FF45\FF4E\FF3A\00A0'),'TenZ','NFKC and whitespace normalize identically');
select is(private.normalize_player_key(U&'\00C9LITE'),'Élite','case folding intentionally changes ASCII only');
select throws_ok($$select private.normalize_player_key(E'Ten\001Z')$$,'P0001','INVALID_REQUEST','control characters are not silently removed');
select throws_ok($$update private.scenario_version_players set player_id='76af0a04-4751-4d26-9233-183a252e124b'$$,'P0001','IMMUTABLE_RECORD','historical mappings cannot be rewritten');

create temporary table catalogue_state(name text primary key,value jsonb);
grant select,insert,update on catalogue_state to anon,authenticated;
set local role anon;
insert into catalogue_state values('starter',public.list_library_players());
select is(jsonb_array_length(value->'players'),1,'starter library groups all three scenarios under one player') from catalogue_state where name='starter';
select is(value->'players'->0->'player'->>'id','76af0a04-4751-4d26-9233-183a252e124b','TenZ has a stable canonical route identifier') from catalogue_state where name='starter';
select is(value->'players'->0->>'scenarioCount','3','count includes each current original scenario once') from catalogue_state where name='starter';
select is(value->'players'->0->'scenarios'->0->>'editorialOrigin','curated','starter content retains curated origin') from catalogue_state where name='starter';
select is(value->'players'->0->'scenarios'->0->>'provenance','ai','starter content retains AI analysis attribution') from catalogue_state where name='starter';
select ok(value->'players'->0->'scenarios'->0->'publishedAt'='null'::jsonb,'unknown historical publication dates remain unknown') from catalogue_state where name='starter';
select ok(not exists(select 1 from catalogue_state,jsonb_array_elements(value->'players'->0->'scenarios') s where name='starter' and s ?| array['question','decision','options','analysis','observedAction','reveal','creator_id','review','optionFeedback','storagePath']),'guest cards never expose choices, answers or private metadata');
select is(public.get_library_preview('bind-clove-utility-window')->'player'->>'displayName','TenZ','guest can open curated slug metadata');
select ok(public.get_library_player('10000000-0000-4000-8000-000000000001') is null,'unknown player routes do not invent an identity');
select throws_like($$select * from public.players$$,'%permission denied%','public table remains inaccessible to guests');
select throws_like($$select * from private.scenario_answer_keys$$,'%permission denied%','answers remain inaccessible to guests');
select throws_like($$select public.start_selected_training_session('46000000-0000-4000-8000-000000000001','{"kind":"scenario","scenarioId":"bind-clove-utility-window"}')$$,'%permission denied%','browsing does not grant guest play');
select throws_ok($$select public.list_library_players('',null,51)$$,'P0001','INVALID_REQUEST','player pages are bounded');
select throws_ok($$select public.list_library_players('','AA')$$,'P0001','INVALID_REQUEST','malformed player cursor fails safely');
select is(jsonb_array_length(public.list_library_players('  TEnZ  ')->'players'),1,'search normalizes case and spacing');
select is(jsonb_array_length(public.list_library_players('%')->'players'),0,'search treats SQL wildcard as literal text');
reset role;

insert into auth.users(id,email,email_confirmed_at) values
('46000000-0000-4000-8000-000000000001','catalogue-verified@example.test',now()),
('46000000-0000-4000-8000-000000000002','catalogue-other@example.test',now()),
('46000000-0000-4000-8000-000000000003','catalogue-unverified@example.test',null);
-- Fixtures exercise the same version-insertion trigger used by creator publication.
insert into public.scenarios(id,title,topic,sort_order,is_published,creator_id,first_published_at,published_at)
select '46000000-0000-4000-8000-'||lpad(n::text,12,'0'),'Catalogue test '||n,'timing',n,true,'46000000-0000-4000-8000-000000000001','2026-11-20T00:00:00Z','2026-11-20T00:00:00Z' from generate_series(10,13) n;
insert into public.scenario_versions(id,scenario_id,content_version,challenge,checksum)
select ('46000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,'46000000-0000-4000-8000-'||lpad(n::text,12,'0'),'catalogue-1',
  jsonb_set(v.challenge||jsonb_build_object('id','46000000-0000-4000-8000-'||lpad(n::text,12,'0'),'contentVersion','catalogue-1'),'{source,player}',to_jsonb(case when n=10 then '  Ａｌｅｘ  ' else 'alex' end)), 'fixture'
from generate_series(10,13) n cross join public.scenario_versions v where v.scenario_id='bind-clove-utility-window' and v.content_version='vod-1';
insert into private.scenario_answer_keys(scenario_version_id,answer_key,review)
select ('46000000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,jsonb_set(k.answer_key,'{analysis,author}','"creator"'),k.review
from generate_series(10,13) n cross join public.scenario_versions v join private.scenario_answer_keys k on k.scenario_version_id=v.id where v.scenario_id='bind-clove-utility-window' and v.content_version='vod-1';
update public.scenarios set current_version=('46000000-0000-4000-8000-'||lpad((right(id,12)::integer+100)::text,12,'0'))::uuid where creator_id='46000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.players where normalized_key='alex'),1,'compatibility spelling and case variants share one canonical player');
insert into catalogue_state select 'alex',to_jsonb(id) from public.players where normalized_key='alex';
insert into private.player_aliases(normalized_key,player_id) select 'old alex',id from public.players where normalized_key='alex';
set local role anon;
select is(public.list_library_players('alex')->'players'->0->>'scenarioCount','4','group counts all visible current scenarios');
select is(jsonb_array_length(public.list_library_players('alex')->'players'->0->'scenarios'),3,'group embeds at most three previews independent of count');
select is(public.list_library_players('old alex')->'players'->0->'player'->>'displayName','Alex','aliases resolve to the canonical display name');
insert into catalogue_state values('players-page',public.list_library_players('',null,1));
select is(jsonb_array_length(public.list_library_players('',value->>'nextCursor',1)->'players'),1,'player cursor pages complete groups') from catalogue_state where name='players-page';
select throws_ok(format('select public.list_library_players(%L,%L,1)','tenz',value->>'nextCursor'),'P0001','INVALID_REQUEST','player cursor cannot switch search query') from catalogue_state where name='players-page';
insert into catalogue_state select 'scenario-page',public.list_library_previews(null,2,(value#>>'{}')::uuid) from catalogue_state where name='alex';
select throws_ok(format('select public.list_library_previews(%L,2,null)',value->>'nextCursor'),'P0001','INVALID_REQUEST','filtered scenario cursor cannot become unfiltered') from catalogue_state where name='scenario-page';
select throws_ok(format('select public.list_library_previews(%L,2,%L)',value->>'nextCursor','76af0a04-4751-4d26-9233-183a252e124b'),'P0001','INVALID_REQUEST','scenario cursor cannot switch player') from catalogue_state where name='scenario-page';
reset role;
update public.scenarios set is_published=false where id=(select value->'scenarios'->1->>'id' from catalogue_state where name='scenario-page');
set local role anon;
select is(jsonb_array_length(public.list_library_previews((select value->>'nextCursor' from catalogue_state where name='scenario-page'),2,(value#>>'{}')::uuid)->'scenarios'),2,'pagination survives withdrawal of its anchor') from catalogue_state where name='alex';
select is(public.list_library_players('alex')->'players'->0->>'scenarioCount','3','withdrawal updates counts immediately');
reset role;
update public.scenarios set is_published=false where creator_id='46000000-0000-4000-8000-000000000001';
set local role anon;
select is(jsonb_array_length(public.list_library_players('alex')->'players'),0,'player with no public scenarios disappears');
select ok(public.get_library_player((value#>>'{}')::uuid) is null,'empty player route is unavailable') from catalogue_state where name='alex';
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok('select public.list_library_players()','unverified learners can browse');
select throws_ok('select public.get_active_training_session()','P0001','EMAIL_NOT_VERIFIED','unverified learners cannot load private active state');
select throws_ok($$select public.start_selected_training_session('46000000-0000-4000-8000-000000000020','{"kind":"scenario","scenarioId":"bind-clove-utility-window"}')$$,'P0001','EMAIL_NOT_VERIFIED','unverified learners cannot play a curated scenario');
select set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select ok(public.get_active_training_session() is null,'active lookup does not create a session');
insert into catalogue_state values('session',public.start_selected_training_session('46000000-0000-4000-8000-000000000020','{"kind":"scenario","scenarioId":"bind-clove-utility-window"}')->'session');
select is(jsonb_array_length(value->'items'),1,'curated scenario selection pins exactly one original version') from catalogue_state where name='session';
select is(public.get_active_training_session()->'target'->>'scenarioId','bind-clove-utility-window','active summary preserves curated slug target');
select ok(not (public.get_active_training_session() ?| array['items','answerKey','options','analysis']),'active summary does not contain private challenge or answer payloads');
select is(public.start_selected_training_session('46000000-0000-4000-8000-000000000020','{"kind":"scenario","scenarioId":"bind-clove-utility-window"}')->>'replayed','true','curated start retains idempotent receipts');
select set_config('request.jwt.claims','{"sub":"46000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select ok(public.get_active_training_session() is null,'active lookup cannot leak another learner session');
reset role;
select * from finish();
rollback;
