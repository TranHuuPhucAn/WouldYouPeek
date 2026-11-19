begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(16);

select is((select count(*)::integer from public.scenario_versions), 3, 'three immutable scenario versions are seeded');
select ok(not has_table_privilege('anon', 'public.scenario_versions', 'SELECT'), 'anonymous has no full-version table grant');
select ok(not has_table_privilege('authenticated', 'private.scenario_answer_keys', 'SELECT'), 'authenticated cannot select private answer keys');
select throws_ok($$update public.scenario_versions set checksum = 'changed'$$, 'P0001', 'IMMUTABLE_RECORD', 'existing scenario version cannot be rewritten');
select throws_ok($$update private.scenario_answer_keys set review = '{}'$$, 'P0001', 'IMMUTABLE_RECORD', 'existing answer key cannot be rewritten');
select throws_like($$insert into public.scenario_versions(id, scenario_id, content_version, challenge, checksum)
  values ('20000000-0000-4000-8000-000000000091', 'bind-clove-utility-window', 'missing-id-test', '{"contentVersion":"missing-id-test"}', 'test-only')$$,
  '%challenge_identity%', 'missing challenge ID fails the identity constraint');
select throws_like($$insert into public.scenario_versions(id, scenario_id, content_version, challenge, checksum)
  values ('20000000-0000-4000-8000-000000000092', 'bind-clove-utility-window', 'missing-version-test', '{"id":"bind-clove-utility-window"}', 'test-only')$$,
  '%challenge_identity%', 'missing challenge content version fails the identity constraint');

set local role anon;
select is(jsonb_array_length(public.list_scenario_previews()), 3, 'guest catalogue has three previews');
select ok(not exists (
  select 1 from jsonb_array_elements(public.list_scenario_previews()) preview
  where preview ?| array['question','options','decision','reveal','observedAction','analysis','review','outcomeText','optionFeedback','takeaway']
), 'public previews omit every question and answer field');
select ok((public.get_scenario_preview('bind-clove-utility-window')->'setup'->>'endSeconds')::numeric = 1713, 'preview ends at decision boundary');
select is(public.get_scenario_preview('missing'), null::jsonb, 'unknown scenario preview is null');
select throws_like('select * from public.scenario_versions', '%permission denied%', 'direct anonymous full-version query denied');
select throws_like('select * from private.scenario_answer_keys', '%permission denied%', 'direct anonymous answer-key query denied');
select throws_like($$select public.start_training_session('20000000-0000-4000-8000-000000000001')$$, '%permission denied%', 'anonymous session RPC denied');
select throws_like($$select public.get_training_session('20000000-0000-4000-8000-000000000001')$$, '%permission denied%', 'anonymous saved-session RPC denied');
select throws_like($$select private.scenario_preview('{}'::jsonb)$$, '%permission denied%', 'projection helper is not a public RPC');
reset role;
select * from finish();
rollback;
