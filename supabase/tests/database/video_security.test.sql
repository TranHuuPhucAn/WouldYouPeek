begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- SQL fixtures exercise authorization and fencing only. Actual Storage bytes,
-- resumable uploads and object cleanup are covered by the integration suite.
select ok(not exists(select 1 from pg_roles where rolname in ('wyp_video_rpc','wyp_media_validator') and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)),'both media roles have no elevated role flags');
select is((select count(*)::integer from pg_tables where schemaname in ('public','private','storage','auth') and tableowner in ('wyp_video_rpc','wyp_media_validator')),0,'media runtime roles own no tables');
select ok(not has_schema_privilege('wyp_video_rpc','auth','USAGE'),'media RPC role has no managed auth schema access');
select ok(not has_schema_privilege('wyp_video_rpc','private','CREATE') and not has_schema_privilege('wyp_video_rpc','public','CREATE'),'temporary function ownership privileges were removed');
select ok(not pg_has_role('authenticator','wyp_video_rpc','MEMBER'),'API authenticator cannot select the internal media function role');
select ok(not has_table_privilege('authenticated','private.video_assets','SELECT') and not has_table_privilege('wyp_media_validator','private.video_assets','SELECT'),'users and validator have no direct asset table reads');
select ok(not has_table_privilege('authenticated','private.video_assets','UPDATE') and not has_table_privilege('wyp_media_validator','private.video_assets','UPDATE'),'users and validator cannot write trusted metadata directly');
select ok(not has_table_privilege('wyp_media_validator','private.scenario_answer_keys','SELECT'),'validator cannot read answer keys');
select ok(not has_table_privilege('wyp_media_validator','public.profiles','UPDATE'),'validator cannot enable roles or forge verification');
select ok(not has_table_privilege('wyp_media_validator','storage.objects','INSERT') and not has_table_privilege('wyp_media_validator','storage.objects','UPDATE') and not has_table_privilege('wyp_media_validator','storage.objects','DELETE'),'validator has no Storage write privileges');
select ok(not has_table_privilege('wyp_video_rpc','private.media_validator_identity','UPDATE') and not has_table_privilege('wyp_media_validator','private.media_validator_identity','SELECT') and not has_table_privilege('authenticated','private.media_validator_identity','SELECT'),'only local setup administration can change the project binding');
select ok(not has_table_privilege('wyp_video_rpc','private.video_asset_commands','UPDATE') and not has_table_privilege('wyp_video_rpc','private.video_asset_commands','DELETE'),'media command receipts are immutable to the runtime');
select ok(not has_table_privilege('wyp_video_rpc','private.scenario_version_assets','UPDATE') and not has_table_privilege('wyp_video_rpc','private.scenario_version_assets','DELETE'),'published media references are immutable to the runtime');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('video_assets','video_asset_commands','scenario_draft_assets','scenario_version_assets','media_validator_identity','media_validator_status') and (not c.relrowsecurity or not c.relforcerowsecurity)),'all media tables force RLS');
select ok(not exists(select 1 from pg_proc where proowner='wyp_video_rpc'::regrole and (proconfig is null or not ('search_path=""'=any(proconfig)))),'every media helper and RPC pins an empty search path');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proowner='wyp_video_rpc'::regrole and has_function_privilege('anon',p.oid,'EXECUTE')),'anonymous callers cannot execute media functions');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proowner='wyp_video_rpc'::regrole and n.nspname='private' and p.proname not in ('video_can_insert','video_can_read','video_can_delete') and has_function_privilege('authenticated',p.oid,'EXECUTE')),'only narrow Storage predicates are callable private helpers');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('report_video_validator_heartbeat','claim_video_validation','renew_video_validation_lease','complete_video_validation','fail_video_validation') and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))),'ordinary callers cannot invoke any validator RPC');
select ok(not has_function_privilege('wyp_media_validator','public.create_creator_video(uuid,text,bigint,text,text)','EXECUTE') and not has_function_privilege('wyp_media_validator','public.create_creator_scenario(uuid)','EXECUTE'),'validator cannot reserve uploads or author scenarios');
select is((select provolatile::text from pg_proc where oid='private.video_can_insert(text,jsonb)'::regprocedure),'v','Storage admission may lock its reservation until insertion commits');
select ok(not (select public from storage.buckets where id='creator-vods'),'creator bucket is private');
select is((select file_size_limit from storage.buckets where id='creator-vods'),2147483648::bigint,'bucket independently enforces the two GiB cap');
select is((select allowed_mime_types from storage.buckets where id='creator-vods'),array['video/mp4']::text[],'bucket accepts only MP4 declarations');

insert into auth.users(id,email,email_confirmed_at) values
('51000000-0000-4000-8000-000000000001','video-security-owner@example.test',now()),
('51000000-0000-4000-8000-000000000002','video-security-foreign@example.test',now()),
('51000000-0000-4000-8000-000000000003','video-security-quota@example.test',now()),
('51000000-0000-4000-8000-000000000004','video-security-unverified@example.test',null);
create temporary table media_state(name text primary key,value jsonb);
grant select,insert,update on media_state to authenticated,wyp_media_validator;
-- Test assertions need the extension namespace; this grant rolls back with fixtures.
grant usage on schema extensions to wyp_media_validator;
insert into private.media_validator_identity(singleton,project_id) values(true,'media-security-project') on conflict(singleton) do update set project_id=excluded.project_id;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000010','recording.mp4',1024,'video/mp4',repeat('a',64))$$,'P0001','CREATOR_REQUIRED','verified learner cannot reserve upload bytes');
select public.enable_creator();
insert into media_state values('first',public.create_creator_video('51000000-0000-4000-8000-000000000010','recording.mp4',1024,'video/mp4',repeat('a',64)));
select is((select value->'video'->>'state' from media_state where name='first'),'pending_upload','new reservation is pending and not playable');
select is(public.create_creator_video('51000000-0000-4000-8000-000000000010','recording.mp4',1024,'video/mp4',repeat('a',64))->>'replayed','true','same request safely replays its reservation');
select is(jsonb_array_length(public.list_creator_videos()->'videos'),1,'reservation replay consumes no second quota slot');
select is(public.get_creator_video_request('51000000-0000-4000-8000-000000000010')->'video'->>'id',(select value->'video'->>'id' from media_state where name='first'),'request recovery returns the original owned upload');
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000010','different.mp4',1024,'video/mp4',repeat('a',64))$$,'P0001','IDEMPOTENCY_CONFLICT','changed request payload cannot replay a reservation');
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000011','recording.mp4',2147483649,'video/mp4',repeat('a',64))$$,'P0001','INVALID_REQUEST','one byte over the per-file limit rejects');
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000011','recording.mp4',0,'video/mp4',repeat('a',64))$$,'P0001','INVALID_REQUEST','empty upload rejects');
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000011','recording.webm',1024,'video/webm',repeat('a',64))$$,'P0001','INVALID_REQUEST','unsupported declared format rejects');
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000011','recording.mp4',1024,'video/mp4','invalid')$$,'P0001','INVALID_REQUEST','malformed resumable file fingerprint rejects');
select throws_like($$select * from private.video_assets$$,'%permission denied%','creator cannot bypass asset projections');
select throws_like($$select public.claim_video_validation()$$,'%permission denied%','creator cannot claim trusted validation work');
insert into media_state values('second',public.create_creator_video('51000000-0000-4000-8000-000000000012','retry.mp4',32,'video/mp4',repeat('b',64)));
insert into media_state values('third',public.create_creator_video('51000000-0000-4000-8000-000000000013','cancel.mp4',32,'video/mp4',repeat('c',64)));
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000014','fourth.mp4',32,'video/mp4',repeat('d',64))$$,'P0001','UPLOAD_LIMIT_REACHED','three concurrent pending reservations block a fourth');
insert into media_state select 'delete-third',public.begin_creator_video_delete((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000015',0) from media_state where name='third';
select is(public.finish_creator_video_delete((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000015')->'video'->>'state','deleted','empty cancelled reservation releases quota only after absence confirmation') from media_state where name='third';
select is(public.finish_creator_video_delete((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000015')->>'replayed','true','confirmed deletion replay is safe') from media_state where name='third';
insert into media_state values('fourth',public.create_creator_video('51000000-0000-4000-8000-000000000014','fourth.mp4',32,'video/mp4',repeat('d',64)));
select is(jsonb_array_length(public.list_creator_videos()->'videos'),3,'confirmed cancellation permits another upload slot');
select ok(not (value->'video' ?| array['objectPath','bucket','objectVersion','validationFence','uploadUrl']),'creator snapshot excludes Storage internals and leases') from media_state where name='first';
select throws_ok(format('select public.complete_creator_video_upload(%L,%L,0)',value->'video'->>'id','51000000-0000-4000-8000-000000000016'),'P0001','VIDEO_NOT_READY','reservation alone cannot claim uploaded bytes') from media_state where name='first';

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.enable_creator();
select is(jsonb_array_length(public.list_creator_videos()->'videos'),0,'second creator sees no foreign reservations');
select is(public.get_creator_video_request('51000000-0000-4000-8000-000000000010')->'video','null'::jsonb,'request recovery cannot disclose another creator upload');
select throws_ok(format('select public.get_creator_video(%L)',value->'video'->>'id'),'P0001','VIDEO_NOT_FOUND','foreign asset read hides its existence') from media_state where name='first';
select throws_ok(format('select public.get_creator_video_upload_session(%L)',value->'video'->>'id'),'P0001','VIDEO_NOT_FOUND','foreign creator cannot acquire its resumable session') from media_state where name='first';
select throws_ok(format('select public.begin_creator_video_delete(%L,%L,0)',value->'video'->>'id','51000000-0000-4000-8000-000000000017'),'P0001','VIDEO_NOT_FOUND','foreign creator cannot cancel its reservation') from media_state where name='first';
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok('select public.list_creator_videos()','P0001','EMAIL_NOT_VERIFIED','unverified user cannot list uploads');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok('select public.list_creator_videos()','P0001','AUTH_REQUIRED','missing user identity rejects');
reset role;

-- Intentionally forged metadata rows never stand in for actual upload tests.
insert into storage.objects(bucket_id,name,metadata,version)
select bucket,object_path,jsonb_build_object('size',byte_size,'mimetype','video/mp4'),'test-version-one' from private.video_assets where id=(select (value->'video'->>'id')::uuid from media_state where name='first');
update private.video_assets set created_at='1990-01-01' where id=(select (value->'video'->>'id')::uuid from media_state where name='first');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),0,'foreign creator cannot read private Storage metadata');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),1,'owner can read their own reserved object');
insert into media_state select 'complete-first',public.complete_creator_video_upload((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000016',0) from media_state where name='first';
select is(value->'video'->>'state','uploaded','completion queues validation without trusting browser codec metadata') from media_state where name='complete-first';
select is(public.complete_creator_video_upload((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000016',0)->>'replayed','true','upload completion is idempotent') from media_state where name='first';
reset role;

set local role wyp_media_validator;
select set_config('request.jwt.claims','{"role":"wyp_media_validator"}',true);
select throws_ok('select public.report_video_validator_heartbeat()','42501','Media validator identity required','worker token without project binding rejects');
select set_config('request.jwt.claims','{"role":"wyp_media_validator","wyp_project_id":"another-project"}',true);
select throws_ok('select public.claim_video_validation()','42501','Media validator identity required','a token scoped to another local project rejects');
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),0,'wrong-project worker has no Storage visibility');
select set_config('request.jwt.claims','{"role":"authenticated","wyp_project_id":"media-security-project"}',true);
select throws_ok('select public.report_video_validator_heartbeat()','42501','Media validator identity required','project claim alone does not confer worker identity');
select set_config('request.jwt.claims','{"role":"wyp_media_validator","wyp_project_id":"media-security-project"}',true);
select ok(public.report_video_validator_heartbeat(),'correctly scoped worker can report liveness');
select throws_like($$select * from private.media_validator_identity$$,'%permission denied%','worker cannot inspect or change the server-side project binding');
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),0,'worker cannot read an uploaded object until a validation lease exists');
insert into media_state values('claim-one',public.claim_video_validation());
select is((select value->>'assetId' from media_state where name='claim-one'),(select value->'video'->>'id' from media_state where name='first'),'worker claims the queued upload');
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),1,'worker can read an object with an active validation lease');
select ok(not public.renew_video_validation_lease((value->>'assetId')::uuid,'51000000-0000-4000-8000-000000000099'),'unrelated fence cannot renew a lease') from media_state where name='claim-one';
select ok(public.renew_video_validation_lease((value->>'assetId')::uuid,(value->>'fence')::uuid),'current fence renews its lease') from media_state where name='claim-one';
select ok(not public.complete_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,'wrong-object-version','{"durationSeconds":12,"width":640,"height":360,"videoCodec":"h264","pixelFormat":"yuv420p","audioCodec":"aac"}'),'matching fence cannot finalize another object identity') from media_state where name='claim-one';
select throws_ok(format('select public.complete_video_validation(%L,%L,%L,%L::jsonb)',value->>'assetId',value->>'fence',value->>'objectVersion','{"durationSeconds":12,"width":3840,"height":2160,"videoCodec":"h264","pixelFormat":"yuv420p","audioCodec":"aac"}'),'P0001','VIDEO_UNSUPPORTED','database rejects unsupported trusted probe dimensions too') from media_state where name='claim-one';
reset role;
update private.video_assets set validation_until=now()-interval '1 second' where id=(select (value->>'assetId')::uuid from media_state where name='claim-one');
set local role wyp_media_validator;
select ok(not public.renew_video_validation_lease((value->>'assetId')::uuid,(value->>'fence')::uuid),'expired fence cannot revive itself') from media_state where name='claim-one';
select ok(not public.fail_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,'MEDIA_PROBE_TIMEOUT',true),'expired worker cannot change failure state') from media_state where name='claim-one';
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),0,'expired lease immediately removes worker object access');
insert into media_state values('claim-two',public.claim_video_validation());
select isnt((select value->>'fence' from media_state where name='claim-one'),(select value->>'fence' from media_state where name='claim-two'),'reclaimed work receives a new fencing token');
select ok(not public.complete_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,value->>'objectVersion','{"durationSeconds":12,"width":640,"height":360,"videoCodec":"h264","pixelFormat":"yuv420p","audioCodec":"aac"}'),'old worker cannot finalize after a reclaim') from media_state where name='claim-one';
select ok(public.complete_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,value->>'objectVersion','{"durationSeconds":12,"width":640,"height":360,"videoCodec":"h264","pixelFormat":"yuv420p","audioCodec":"aac"}'),'current worker finalizes matching identity and supported metadata') from media_state where name='claim-two';
select ok(not public.complete_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,value->>'objectVersion','{"durationSeconds":12,"width":640,"height":360,"videoCodec":"h264","pixelFormat":"yuv420p","audioCodec":"aac"}'),'duplicate completion cannot mutate ready media') from media_state where name='claim-two';
select is((select count(*)::integer from storage.objects where bucket_id='creator-vods'),0,'ready media is no longer readable by the validator');
reset role;

-- A recoverable failure can be retried, but lease crashes consume the same
-- three-attempt budget; terminal attempts cannot remain silently validating.
insert into storage.objects(bucket_id,name,metadata,version)
select bucket,object_path,jsonb_build_object('size',byte_size,'mimetype','video/mp4'),'test-retry-version' from private.video_assets where id=(select (value->'video'->>'id')::uuid from media_state where name='second');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_creator_video((value->'video'->>'id')::uuid)->>'state','ready','creator receives ready only after trusted validation') from media_state where name='first';
insert into media_state select 'complete-second',public.complete_creator_video_upload((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000020',0) from media_state where name='second';
reset role;
set local role wyp_media_validator;
select set_config('request.jwt.claims','{"role":"wyp_media_validator","wyp_project_id":"media-security-project"}',true);
insert into media_state values('retry-claim-one',public.claim_video_validation());
select ok(public.fail_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,'MEDIA_PROBE_TIMEOUT',true),'first transient probe failure is recorded') from media_state where name='retry-claim-one';
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_creator_video((value->'video'->>'id')::uuid)->'failure'->>'retryable','true','creator can see that a transient first failure is retryable') from media_state where name='second';
insert into media_state select 'retry-command',public.retry_creator_video_validation((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000021',3) from media_state where name='second';
select is(public.retry_creator_video_validation((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000021',3)->>'replayed','true','retry command replay does not consume another attempt') from media_state where name='second';
reset role;
set local role wyp_media_validator;
select set_config('request.jwt.claims','{"role":"wyp_media_validator","wyp_project_id":"media-security-project"}',true);
insert into media_state values('retry-claim-two',public.claim_video_validation());
reset role;
update private.video_assets set validation_until=now()-interval '1 second' where id=(select (value->>'assetId')::uuid from media_state where name='retry-claim-two');
set local role wyp_media_validator;
insert into media_state values('retry-claim-three',public.claim_video_validation());
select ok(public.fail_video_validation((value->>'assetId')::uuid,(value->>'fence')::uuid,'MEDIA_PROBE_TIMEOUT',true),'third attempt failure is recorded') from media_state where name='retry-claim-three';
reset role;
select is((select validation_attempts from private.video_assets where id=(select (value->'video'->>'id')::uuid from media_state where name='second')),3,'explicit retry and expired lease reclaim share one attempt budget');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.get_creator_video((value->'video'->>'id')::uuid)->'failure'->>'retryable','false','third transient failure cannot be retried indefinitely') from media_state where name='second';
select throws_ok(format('select public.retry_creator_video_validation(%L,%L,%s)',value->'video'->>'id','51000000-0000-4000-8000-000000000022',public.get_creator_video((value->'video'->>'id')::uuid)->>'revision'),'P0001','VIDEO_CONFLICT','owner cannot bypass the validation attempt limit') from media_state where name='second';
reset role;
update private.video_assets set state='validating',validation_attempts=3,validation_until=now()-interval '1 second',validation_fence=gen_random_uuid() where id=(select (value->'video'->>'id')::uuid from media_state where name='fourth');
set local role wyp_media_validator;
select set_config('request.jwt.claims','{"role":"wyp_media_validator","wyp_project_id":"media-security-project"}',true);
select is(public.claim_video_validation(),null::jsonb,'no fourth claim is issued after the terminal lease expires');
reset role;
select is((select state from private.video_assets where id=(select (value->'video'->>'id')::uuid from media_state where name='fourth')),'rejected','terminal expired lease is visibly rejected');
select is((select failure_code from private.video_assets where id=(select (value->'video'->>'id')::uuid from media_state where name='fourth')),'MEDIA_VALIDATOR_STOPPED','terminal crash has an honest validator-stopped reason');

-- Deletion cannot release bytes on the basis of the caller's claim alone.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into media_state select 'delete-first',public.begin_creator_video_delete((value->'video'->>'id')::uuid,'51000000-0000-4000-8000-000000000023',(public.get_creator_video((value->'video'->>'id')::uuid)->>'revision')::integer) from media_state where name='first';
select throws_ok(format('select public.finish_creator_video_delete(%L,%L)',value->'video'->>'id','51000000-0000-4000-8000-000000000023'),'P0001','VIDEO_CONFLICT','existing Storage object prevents quota release') from media_state where name='first';
select is(public.get_creator_video((value->'video'->>'id')::uuid)->>'state','deleting','interrupted Storage deletion remains recoverable') from media_state where name='first';
reset role;

-- Rejected and deleting reservations still consume the cumulative allowance.
insert into private.video_assets(id,owner_id,object_path,file_name,content_fingerprint,byte_size,state)
select ('51000000-0000-4000-8000-00000000010'||n)::uuid,'51000000-0000-4000-8000-000000000003',
'51000000-0000-4000-8000-000000000003/51000000-0000-4000-8000-00000000010'||n||'/source.mp4','quota.mp4',repeat('e',64),2147483648,'rejected' from generate_series(1,5) n;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select public.enable_creator();
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000030','extra.mp4',1,'video/mp4',repeat('f',64))$$,'P0001','UPLOAD_LIMIT_REACHED','ten GiB owner reservation allowance includes rejected uploads');
reset role;
update private.video_assets set state='deleted' where id='51000000-0000-4000-8000-000000000101';
set local role authenticated;
select is(public.create_creator_video('51000000-0000-4000-8000-000000000031','exact-boundary.mp4',2147483648,'video/mp4',repeat('f',64))->'video'->>'byteSize','2147483648','exact per-file and cumulative byte boundary is accepted');
select throws_ok($$select public.create_creator_video('51000000-0000-4000-8000-000000000032','extra.mp4',1,'video/mp4',repeat('f',64))$$,'P0001','UPLOAD_LIMIT_REACHED','one byte over the restored owner allowance rejects');
reset role;
select * from finish();
rollback;
