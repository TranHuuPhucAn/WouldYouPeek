begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(33);
insert into auth.users(id,email,email_confirmed_at) values
('30000000-0000-4000-8000-000000000001','sessions-a@example.test',now()),
('30000000-0000-4000-8000-000000000002','sessions-b@example.test',now());
create temporary table test_state(name text primary key, value jsonb);
grant select, insert, update on test_state to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into test_state values ('start', public.start_training_session('30000000-0000-4000-8000-000000000010'));
insert into test_state select 'snapshot', value->'session' from test_state where name = 'start';
select is((select value->>'created' from test_state where name = 'start'), 'true', 'first start creates a session');
select is((select jsonb_array_length(value->'items') from test_state where name = 'snapshot'), 3, 'session pins all three versions');
select is((select value->>'revision' from test_state where name = 'snapshot'), '0', 'session begins at revision zero');
select is((public.start_training_session('30000000-0000-4000-8000-000000000011'))->>'created', 'false', 'different start request resumes the active session');
select is((select count(*)::integer from public.training_sessions), 1, 'only one active session exists');
select ok(not exists (select 1 from test_state, jsonb_array_elements(value->'items') item where name = 'snapshot' and item->'answer' <> 'null'::jsonb), 'unanswered snapshots disclose no answer');
select throws_like($$update public.training_sessions set revision = 100$$, '%permission denied%', 'caller cannot forge progress directly');
select throws_like($$insert into public.attempts(item_id,session_id,user_id,option_id,answer) values (gen_random_uuid(),gen_random_uuid(),auth.uid(),'invented','{}')$$, '%permission denied%', 'caller cannot forge answers directly');

select throws_ok(format('select public.submit_session_answer(%L,%L,%L,%L,0)',
  value->>'id', value->'items'->0->>'id', 'missing-option', '30000000-0000-4000-8000-000000000020'),
  'P0001','INVALID_OPTION','invalid answer rejects transaction') from test_state where name = 'snapshot';
select is((select count(*)::integer from public.attempts), 0, 'failed answer leaves no attempt');
select is((select revision from public.training_sessions), 0, 'failed answer leaves progress unchanged');
insert into test_state select 'answer', public.submit_session_answer((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'use-meddle','30000000-0000-4000-8000-000000000020',0) from test_state where name = 'snapshot';
select is((select value->'session'->>'phase' from test_state where name = 'answer'),'review','answer persists the review checkpoint');
select is((select value->'session'->>'revision' from test_state where name = 'answer'),'1','answer increments revision once');
select is((public.submit_session_answer((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'use-meddle','30000000-0000-4000-8000-000000000020',0))->>'replayed','true','identical retry succeeds before checking stale revision') from test_state where name = 'snapshot';
select is((select count(*)::integer from public.attempts),1,'retry stores only one attempt');
select throws_ok(format('select public.submit_session_answer(%L,%L,%L,%L,0)',value->>'id',value->'items'->0->>'id','cover-contact','30000000-0000-4000-8000-000000000020'),'P0001','IDEMPOTENCY_CONFLICT','same request key cannot change payload') from test_state where name='snapshot';
select throws_ok(format('select public.submit_session_answer(%L,%L,%L,%L,0)',value->>'id',value->'items'->0->>'id','use-meddle','30000000-0000-4000-8000-000000000021'),'P0001','SESSION_CONFLICT','new stale answer fails') from test_state where name='snapshot';
insert into test_state select 'advance', public.advance_training_session((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'30000000-0000-4000-8000-000000000030',1) from test_state where name='snapshot';
select is((select value->'session'->>'currentIndex' from test_state where name='advance'),'1','advance moves exactly one item');
select is((public.advance_training_session((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'30000000-0000-4000-8000-000000000030',1))->'session'->>'currentIndex','1','replayed advance never skips') from test_state where name='snapshot';
select is((public.submit_session_answer((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'use-meddle','30000000-0000-4000-8000-000000000020',0))->'session'->>'revision','2','old answer retry returns current canonical revision') from test_state where name='snapshot';

select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.training_sessions),0,'another learner cannot directly read the session');
select throws_ok(format('select public.get_training_session(%L)',value->>'id'),'P0001','SESSION_NOT_FOUND','foreign session RPC hides existence') from test_state where name='snapshot';
select is(public.enable_creator()->>'role','creator','second learner can enable creator');
select throws_ok(format('select public.get_training_session(%L)',value->>'id'),'P0001','SESSION_NOT_FOUND','creator cannot read another learner session') from test_state where name='snapshot';
reset role;

-- Publishing a new version must not rewrite already pinned challenge/answer data.
insert into public.scenario_versions(id, scenario_id, content_version, challenge, checksum)
select '30000000-0000-4000-8000-000000000040', scenario_id, 'vod-2-test',
  challenge || '{"contentVersion":"vod-2-test","title":"New catalogue version"}'::jsonb, 'test-only-version'
from public.scenario_versions where scenario_id = 'bind-clove-utility-window' and content_version = 'vod-1';
insert into private.scenario_answer_keys(scenario_version_id, answer_key, review)
select '30000000-0000-4000-8000-000000000040', k.answer_key, k.review
from private.scenario_answer_keys k join public.scenario_versions v on v.id = k.scenario_version_id
where v.scenario_id = 'bind-clove-utility-window' and v.content_version = 'vod-1';
update public.scenarios set current_version = '30000000-0000-4000-8000-000000000040' where id = 'bind-clove-utility-window';
select throws_ok($$update public.attempts set option_id = 'invented'$$, 'P0001', 'IMMUTABLE_RECORD', 'stored attempts remain immutable even to maintenance code');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.get_training_session((value->>'id')::uuid)->'items'->0->'challenge'->>'contentVersion', 'vod-1', 'catalogue publication does not change pinned challenge') from test_state where name='snapshot';
select is(public.get_training_session((value->>'id')::uuid)->'items'->0->'answer'->'result'->>'contentVersion', 'vod-1', 'catalogue publication does not change saved feedback') from test_state where name='snapshot';
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
insert into test_state values ('second', public.start_training_session('30000000-0000-4000-8000-000000000050')->'session');
select is((select value->'items'->0->'challenge'->>'contentVersion' from test_state where name='second'),'vod-2-test','a new session receives the new catalogue version');
reset role;

-- Fault injection after the attempt INSERT proves the entire command is atomic.
create function private.test_abort_session_update() returns trigger language plpgsql set search_path = '' as $$
begin raise exception using errcode = 'P0001', message = 'INJECTED_STORAGE_FAILURE'; end;
$$;
create trigger test_abort_session_update before update on public.training_sessions
for each row when (new.phase = 'review') execute function private.test_abort_session_update();
set local role authenticated;
select throws_ok(format('select public.submit_session_answer(%L,%L,%L,%L,0)',
  value->>'id', value->'items'->0->>'id', 'use-meddle', '30000000-0000-4000-8000-000000000060'),
  'P0001','INJECTED_STORAGE_FAILURE','failure after attempt insertion aborts the whole answer transaction') from test_state where name='second';
select is((select count(*)::integer from public.attempts),0,'failed transaction rolls back inserted attempt');
select is((select revision from public.training_sessions),0,'failed transaction rolls back phase/revision');
reset role;
select is((select count(*)::integer from private.session_commands where request_id = '30000000-0000-4000-8000-000000000060'),0,'failed transaction does not retain a receipt');
drop trigger test_abort_session_update on public.training_sessions;
set local role authenticated;
select is(public.submit_session_answer((value->>'id')::uuid,(value->'items'->0->>'id')::uuid,'use-meddle','30000000-0000-4000-8000-000000000060',0)->>'replayed','false','same request can succeed after failed transaction is repaired') from test_state where name='second';
reset role;
select * from finish();
rollback;
