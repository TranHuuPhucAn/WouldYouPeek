begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('43000000-0000-4000-8000-000000000001','selected-author@example.test',now()),
('43000000-0000-4000-8000-000000000002','selected-learner@example.test',now()),
('43000000-0000-4000-8000-000000000003','selected-other@example.test',now());
create temporary table selected_state(name text primary key,value jsonb);
grant select,insert,update on selected_state to authenticated;
-- Use the same known demo source in an independently owned test scenario.
insert into selected_state
select 'content',jsonb_build_object('title','One creator scenario','topic',c->'topic','context',c->'context','question',c->'question',
  'source',jsonb_build_object('url',c->'source'->'url','title',c->'source'->'title','uploader',c->'source'->'uploader','player',c->'source'->'player',
    'map',c->'source'->'map','agent',c->'source'->'agent','score','7-3','matchType',c->'source'->'matchType','round',c->'source'->'round','side',c->'source'->'side','publishedDate','','dateNote',''),
  'media',jsonb_build_object('startSeconds',c->'setup'->'startSeconds','decisionSeconds',c->'decision'->'atSeconds','endSeconds',k->'reveal'->'endSeconds',
    'setupAlt',c->'setup'->'alt','decisionAlt',c->'decision'->'alt','revealAlt',k->'reveal'->'alt'),
  'knownFacts',c->'knownFacts','unknowns',c->'unknowns',
  'options',(select jsonb_agg(jsonb_build_object('id','43000000-0000-4000-8000-'||lpad(n::text,12,'0'),'label',o->'label','assessment',f->'assessment','explanation',f->'explanation','acceptableWhen',f->'acceptableWhen','risks',f->'risks') order by n)
    from jsonb_array_elements(c->'options') with ordinality opts(o,n) join lateral jsonb_array_elements(k->'optionFeedback') f on f->>'optionId'=o->>'id'),
  'observedAction',jsonb_build_object('optionId',(select '43000000-0000-4000-8000-'||lpad(n::text,12,'0') from jsonb_array_elements(c->'options') with ordinality opts(o,n) where o->>'id'=k->'observedAction'->>'optionId'),'description',k->'observedAction'->'description'),
  'analysis',jsonb_build_object('author','creator','rationale',k->'analysis'->'rationale','limitations',k->'analysis'->'limitations'),
  'takeaway',k->'takeaway','outcomeText',k->'outcomeText')
from (select v.challenge c,a.answer_key k from public.scenario_versions v join private.scenario_answer_keys a on a.scenario_version_id=v.id where v.scenario_id='bind-clove-utility-window' and v.content_version='vod-1') fixture;
insert into selected_state values('checklist','{"povInformationChecked":true,"setupSpoilersChecked":true,"pauseTimingChecked":true,"continuationChecked":true,"normalSpeedAudioChecked":true,"alternativeChoicesChecked":true,"sourceAttributionChecked":true}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.enable_creator();
insert into selected_state values('draft',public.create_creator_scenario('43000000-0000-4000-8000-000000000010')->'scenario');
insert into selected_state select 'saved',public.save_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000011',0,(select value from selected_state where name='content'))->'scenario' from selected_state where name='draft';
insert into selected_state select 'review',public.review_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000012',1,(select value from selected_state where name='checklist'))->'scenario' from selected_state where name='saved';
insert into selected_state select 'live',public.publish_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000013',2,(value->'review'->>'id')::uuid)->'scenario' from selected_state where name='review';
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into selected_state select 'session',public.start_selected_training_session('43000000-0000-4000-8000-000000000020',jsonb_build_object('kind','scenario','scenarioId',value->>'id'))->'session' from selected_state where name='live';
select is((select jsonb_array_length(value->'items') from selected_state where name='session'),1,'library start pins exactly one item');
select is((select value->'target'->>'kind' from selected_state where name='session'),'scenario','session records selected target');
select is((select value->>'title' from selected_state where name='session'),'One creator scenario','session pins the selected title');
select ok((select value->'items'->0->'answer'='null'::jsonb from selected_state where name='session'),'unanswered session does not reveal the answer');
select ok(not ((select value->'items'->0->'challenge' from selected_state where name='session') ?| array['analysis','observedAction','reveal','optionFeedback']),'unanswered challenge has no private authoring fields');
select throws_ok($$select public.start_training_session('43000000-0000-4000-8000-000000000021')$$,'P0001','ACTIVE_SESSION_EXISTS','legacy demo start cannot silently substitute an active creator scenario');
select throws_ok($$select public.start_selected_training_session('43000000-0000-4000-8000-000000000020','{"kind":"demo"}')$$,'P0001','IDEMPOTENCY_CONFLICT','selected receipt cannot change target');
select throws_like($$update public.training_sessions set target_kind='demo'$$,'%permission denied%','client cannot rewrite its session target');
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into selected_state select 'changed',public.save_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000030',3,jsonb_set(value->'draft'->'content','{title}','"Updated creator scenario"'))->'scenario' from selected_state where name='live';
insert into selected_state select 'review2',public.review_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000031',4,(select value from selected_state where name='checklist'))->'scenario' from selected_state where name='changed';
insert into selected_state select 'live2',public.publish_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000032',5,(value->'review'->>'id')::uuid)->'scenario' from selected_state where name='review2';
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.start_selected_training_session('43000000-0000-4000-8000-000000000033',jsonb_build_object('kind','scenario','scenarioId',value->>'id'))->'session'->'items'->0->'challenge'->>'contentVersion','creator-2','new learner receives the newly published version') from selected_state where name='live2';
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.start_selected_training_session('43000000-0000-4000-8000-000000000034',jsonb_build_object('kind','scenario','scenarioId',value->>'id'))->'session'->'items'->0->'challenge'->>'contentVersion','creator-1','same-target resume keeps old pinned version') from selected_state where name='live2';
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into selected_state select 'withdrawn',public.unpublish_creator_scenario(value->>'id','43000000-0000-4000-8000-000000000035',6)->'scenario' from selected_state where name='live2';
select throws_ok(format('select public.start_selected_training_session(%L,%L::jsonb)','43000000-0000-4000-8000-000000000036',jsonb_build_object('kind','scenario','scenarioId',value->>'id')::text),'P0001','SCENARIO_UNAVAILABLE','withdrawn item prevents a new creator/learner session') from selected_state where name='withdrawn';
select set_config('request.jwt.claims','{"sub":"43000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.start_selected_training_session('43000000-0000-4000-8000-000000000037',jsonb_build_object('kind','scenario','scenarioId',value->>'id'))->'session'->'items'->0->'challenge'->>'contentVersion','creator-1','ordinary withdrawal still permits existing same-target resume') from selected_state where name='withdrawn';
insert into selected_state select 'answered',public.submit_session_answer((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,value->'items'->0->'challenge'->'options'->0->>'id','43000000-0000-4000-8000-000000000040',0)->'session' from selected_state where name='session';
select is((select value->'items'->0->'answer'->'result'->>'contentVersion' from selected_state where name='answered'),'creator-1','answer uses pinned old key after republish and withdrawal');
insert into selected_state select 'finished',public.advance_training_session((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'43000000-0000-4000-8000-000000000041',1)->'session' from selected_state where name='session';
select is((select value->>'phase' from selected_state where name='finished'),'completed','single item requires explicit Finish after review');
select is((select value->>'title' from selected_state where name='finished'),'One creator scenario','completion retains original title');
select is(public.start_selected_training_session('43000000-0000-4000-8000-000000000020',jsonb_build_object('kind','scenario','scenarioId',value->>'id'))->'session'->>'phase','completed','start retry returns original completed session even after withdrawal') from selected_state where name='withdrawn';
select throws_ok(format('select public.start_selected_training_session(%L,%L::jsonb)','43000000-0000-4000-8000-000000000042',jsonb_build_object('kind','scenario','scenarioId',value->>'id')::text),'P0001','SCENARIO_UNAVAILABLE','fresh replay after completion cannot start withdrawn content') from selected_state where name='withdrawn';
select is(public.list_training_sessions()->'sessions'->0->>'title','One creator scenario','history uses pinned session title');
select is(jsonb_array_length(public.start_training_session('43000000-0000-4000-8000-000000000043')->'session'->'items'),3,'creator publications never expand the demo session');
reset role;
select throws_ok($$update public.training_sessions set target_title='Rewritten' where user_id='43000000-0000-4000-8000-000000000002'$$,'P0001','IMMUTABLE_RECORD','maintenance cannot silently rewrite selected history title');
select * from finish();
rollback;
