begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values('42000000-0000-4000-8000-000000000001','creator-publish@example.test',now());
create temporary table publication_state(name text primary key,value jsonb);
grant select,insert,update on publication_state to authenticated;
insert into publication_state values('content','{
 "title":"Timing before contact","topic":"Utility timing","context":"Only the player POV is known.","question":"Would you take contact now?",
 "source":{"url":"https://youtu.be/_yPrykaB2nE","title":"Source VOD","uploader":"TenZ","player":"TenZ","map":"Bind","agent":"Clove","score":"5-6","matchType":"ranked","round":12,"side":"attack","publishedDate":"","dateNote":""},
 "media":{"startSeconds":100,"decisionSeconds":108,"endSeconds":115,"setupAlt":"Approaching the angle","decisionAlt":"Choose before contact","revealAlt":"The observed continuation"},
 "knownFacts":["Utility remains available."],"unknowns":[],
 "options":[{"id":"42000000-0000-4000-8000-000000000101","label":"Use utility","assessment":"reasonable","explanation":"Utility can narrow the immediate duel.","acceptableWhen":[],"risks":[]},{"id":"42000000-0000-4000-8000-000000000102","label":"Hold contact","assessment":"reasonable","explanation":"Holding can be defensible while support arrives.","acceptableWhen":[],"risks":[]}],
 "observedAction":{"optionId":"42000000-0000-4000-8000-000000000101","description":"The player uses utility before moving."},
 "analysis":{"author":"creator","rationale":"The timing depends on the available support; this is an interpretation.","limitations":[]},
 "takeaway":"Compare timing and support.","outcomeText":"Utility precedes the next contact."
}'::jsonb),('checklist','{"povInformationChecked":true,"setupSpoilersChecked":true,"pauseTimingChecked":true,"continuationChecked":true,"normalSpeedAudioChecked":true,"alternativeChoicesChecked":true,"sourceAttributionChecked":true}');
select is(jsonb_array_length(private.validate_creator_draft((select value from publication_state where name='content'),true)),0,'publish-ready draft allows deliberately empty uncertainty and condition lists');
select is(jsonb_array_length(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{knownFacts}','[]'),false)),0,'draft can save before a visible fact has been entered');
select ok(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{knownFacts}','[]'),true) @> '[{"path":"knownFacts"}]'::jsonb,'publication requires at least one player-visible fact');
select ok(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{knownFacts}','["  "]'),true) @> '[{"path":"knownFacts"}]'::jsonb,'blank facts do not satisfy publication readiness');
select ok(jsonb_array_length(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{source,side}','false'),false))>0,'literal false is not a valid source enum');
select ok(jsonb_array_length(private.validate_creator_draft((select value from publication_state where name='content')- 'title',false))>0,'missing JSON keys do not pass SQL validation');
select ok(jsonb_array_length(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{media,decisionSeconds}','100'),true))>0,'SQL rejects zero-duration setup');
select ok(jsonb_array_length(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{options,1,id}','"42000000-0000-4000-8000-000000000101"'),false))>0,'duplicate choice identifiers reject');
select ok(jsonb_array_length(private.validate_creator_draft(jsonb_set((select value from publication_state where name='content'),'{source,url}','"https://youtube.com.evil.test/watch?v=_yPrykaB2nE"'),true))>0,'YouTube lookalike host rejects');
select is(private.creator_youtube_id('https://youtu.be/_yPrykaB2nE?v=_yPrykaB2nE'),'_yPrykaB2nE','same short-link video parameter is unambiguous');
select is(private.creator_youtube_id('https://youtu.be/_yPrykaB2nE#?v=other'),'_yPrykaB2nE','a fragment cannot add another video selection');
select is(private.creator_youtube_id('https://www.youtube.com/watch?v=_yPrykaB2nE&v'),null::text,'bare duplicate video parameter rejects');
select is(private.creator_youtube_id('https://www.youtube.com/watch?v=_yPrykaB2nE&%76=other'),null::text,'encoded duplicate video parameter rejects');
select is(private.creator_youtube_id('https://www.youtube.com/foo/../watch?v=_yPrykaB2nE'),null::text,'source path must be literal supported watch path');
select is(private.creator_youtube_id(U&'https://youtu.be/_yPrykaB2nE?si=bad\00A0value'),null::text,'embedded Unicode whitespace rejects');
select is(private.creator_trim(U&'\00A0\FEFFTitle\202F'),'Title','normalization matches Unicode whitespace trimming');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"42000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.enable_creator();
insert into publication_state values('created',public.create_creator_scenario('42000000-0000-4000-8000-000000000010')->'scenario');
select throws_ok(format('select public.get_creator_review_preview(%L,0)',value->>'id'),'P0001','DRAFT_NOT_READY','incomplete draft cannot enter learner preview') from publication_state where name='created';
insert into publication_state select 'saved',public.save_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000011',0,(select value from publication_state where name='content'))->'scenario' from publication_state where name='created';
select is((select value->'draft'->>'revision' from publication_state where name='saved'),'1','first content save advances draft revision');
select is((select value->'draft'->'content'->'source'->>'url' from publication_state where name='saved'),'https://www.youtube.com/watch?v=_yPrykaB2nE','save canonicalizes a short source URL');
select is(public.save_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000011',0,(select value from publication_state where name='content'))->>'replayed','true','save retry is found before its now-stale expected revision') from publication_state where name='saved';
select throws_ok(format('select public.save_creator_scenario(%L,%L,0,%L::jsonb)',value->>'id','42000000-0000-4000-8000-000000000011',jsonb_set((select value from publication_state where name='content'),'{title}','"Different retry payload"')::text),'P0001','IDEMPOTENCY_CONFLICT','reusing a save request with changed content rejects') from publication_state where name='saved';
select is(jsonb_array_length(public.list_creator_scenarios('unpublished')->'scenarios'),1,'never-published filter includes the saved draft');
select throws_ok(format('select public.save_creator_scenario(%L,%L,0,%L::jsonb)',value->>'id','42000000-0000-4000-8000-000000000012',(select value::text from publication_state where name='content')),'P0001','SCENARIO_CONFLICT','second stale tab cannot overwrite content') from publication_state where name='saved';
select throws_ok(format('select public.publish_creator_scenario(%L,%L,1,%L)',value->>'id','42000000-0000-4000-8000-000000000013','42000000-0000-4000-8000-000000000099'),'P0001','REVIEW_REQUIRED','publication needs a current owner review') from publication_state where name='saved';
insert into publication_state select 'preview',public.get_creator_review_preview(value->>'id',1) from publication_state where name='saved';
select is((select count(*)::integer from public.training_sessions),0,'owner preview creates no training session');
select is((select count(*)::integer from public.attempts),0,'owner preview records no attempt');
select is((select value->'feedbackByOption'->'42000000-0000-4000-8000-000000000102'->>'matchesPro' from publication_state where name='preview'),'false','preview distinguishes the other defensible choice from the pro');
select is((select value->'feedbackByOption'->'42000000-0000-4000-8000-000000000102'->>'selectedAssessment' from publication_state where name='preview'),'reasonable','different pro choice can remain defensible');
insert into publication_state select 'reviewed',public.review_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000014',1,(select value from publication_state where name='checklist'))->'scenario' from publication_state where name='saved';
select is((select value->'draft'->>'revision' from publication_state where name='reviewed'),'1','review increments only the resource revision');
insert into publication_state select 'noop',public.save_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000015',2,jsonb_set(value->'draft'->'content','{title}',to_jsonb('  Timing before contact  '::text)))->'scenario' from publication_state where name='reviewed';
select is((select value->'review'->>'id' from publication_state where name='noop'),(select value->'review'->>'id' from publication_state where name='reviewed'),'no-op save retains exact review receipt');
select is((select value->'draft'->>'revision' from publication_state where name='noop'),'1','no-op save retains draft revision');
insert into publication_state select 'published',public.publish_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000016',3,(value->'review'->>'id')::uuid) from publication_state where name='noop';
select is((select value->>'publishedVersion' from publication_state where name='published'),'creator-1','first publication identifies immutable version');
select is((select value->'scenario'->'publication'->>'state' from publication_state where name='published'),'published','publication switches live visibility');
select is((public.list_creator_scenarios('published')->'scenarios'->0->'publication'->>'state'),'published','published filter selects live state');
select is(jsonb_array_length(public.list_creator_scenarios('unpublished')->'scenarios'),0,'published item leaves never-published filter');
select is(public.get_library_preview(value->'scenario'->>'id')->>'provenance','creator','library labels creator provenance') from publication_state where name='published';
select ok(not (public.get_library_preview(value->'scenario'->>'id') ?| array['options','analysis','observedAction','reveal','review','creator_id']),'library projection discloses setup only') from publication_state where name='published';
insert into publication_state select 'edited',public.save_creator_scenario(value->'scenario'->>'id','42000000-0000-4000-8000-000000000017',4,jsonb_set(value->'scenario'->'draft'->'content','{title}','"A revised moment"'))->'scenario' from publication_state where name='published';
select is((select value->'review' from publication_state where name='edited'),'null'::jsonb,'content edit invalidates old review');
select is(public.get_library_preview(value->>'id')->>'title','Timing before contact','unpublished edits do not change learner listing') from publication_state where name='edited';
select is((public.publish_creator_scenario(value->'scenario'->>'id','42000000-0000-4000-8000-000000000016',3,(select (value->'review'->>'id')::uuid from publication_state where name='noop')))->'scenario'->>'revision','5','delayed publication retry returns latest canonical draft') from publication_state where name='published';
select throws_ok(format('select public.publish_creator_scenario(%L,%L,5,%L)',value->>'id','42000000-0000-4000-8000-000000000018',(select value->'review'->>'id' from publication_state where name='noop')),'P0001','REVIEW_REQUIRED','old review cannot approve changed content') from publication_state where name='edited';
insert into publication_state select 'review2',public.review_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000019',5,(select value from publication_state where name='checklist'))->'scenario' from publication_state where name='edited';
reset role;
create function private.test_abort_creator_key() returns trigger language plpgsql set search_path='' as $$ begin raise exception using errcode='P0001',message='INJECTED_PUBLICATION_FAILURE'; end $$;
create trigger test_abort_creator_key before insert on private.scenario_answer_keys for each row execute function private.test_abort_creator_key();
set local role authenticated;
select throws_ok(format('select public.publish_creator_scenario(%L,%L,6,%L)',value->>'id','42000000-0000-4000-8000-000000000020',value->'review'->>'id'),'P0001','INJECTED_PUBLICATION_FAILURE','failure after version insert rolls back entire publication') from publication_state where name='review2';
reset role;
select is((select count(*)::integer from public.scenario_versions where scenario_id=(select value->>'id' from publication_state where name='created')),1,'failed publication rolls back newly inserted version');
select is((select count(*)::integer from private.creator_commands where request_id='42000000-0000-4000-8000-000000000020'),0,'failed publication leaves no retry receipt');
drop trigger test_abort_creator_key on private.scenario_answer_keys;
set local role authenticated;
insert into publication_state select 'published2',public.publish_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000020',6,(value->'review'->>'id')::uuid) from publication_state where name='review2';
select is((select value->>'publishedVersion' from publication_state where name='published2'),'creator-2','retry after rolled-back failure publishes one new version');
select is((public.publish_creator_scenario(value->'scenario'->>'id','42000000-0000-4000-8000-000000000016',3,(select (value->'review'->>'id')::uuid from publication_state where name='noop')))->>'publishedVersion','creator-1','old receipt identifies its own version after later publication') from publication_state where name='published2';
insert into publication_state select 'withdrawn',public.unpublish_creator_scenario(value->'scenario'->>'id','42000000-0000-4000-8000-000000000021',7)->'scenario' from publication_state where name='published2';
select is((select value->'publication'->>'state' from publication_state where name='withdrawn'),'withdrawn','unpublish delists');
select is((select value->'review' from publication_state where name='withdrawn'),'null'::jsonb,'withdrawal clears the current review');
select throws_ok(format('select public.get_library_preview(%L)',value->>'id'),'P0001','SCENARIO_UNAVAILABLE','withdrawn item cannot be read as a new library item') from publication_state where name='withdrawn';
select is(jsonb_array_length(public.list_creator_scenarios('withdrawn')->'scenarios'),1,'withdrawn filter retains owner visibility');
insert into publication_state select 'review3',public.review_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000022',8,(select value from publication_state where name='checklist'))->'scenario' from publication_state where name='withdrawn';
select is(public.publish_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000023',9,(value->'review'->>'id')::uuid)->>'publishedVersion','creator-2','restoring identical content reuses its immutable version') from publication_state where name='review3';
select is(public.unpublish_creator_scenario(value->>'id','42000000-0000-4000-8000-000000000021',7)->'scenario'->'publication'->>'state','published','delayed withdrawal retry does not withdraw a later restoration') from publication_state where name='review3';
reset role;
select is((select count(*)::integer from public.scenario_versions where scenario_id=(select value->>'id' from publication_state where name='created')),2,'restore creates no duplicate version');
select throws_ok(format('update public.scenario_versions set checksum=%L where scenario_id=%L','forged',(select value->>'id' from publication_state where name='created')),'P0001','IMMUTABLE_RECORD','published versions remain immutable');
select throws_ok('update private.scenario_reviews set checksum=''forged''','P0001','IMMUTABLE_RECORD','review evidence remains immutable');
select * from finish();
rollback;
