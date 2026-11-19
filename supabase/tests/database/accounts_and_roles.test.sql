begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);

select ok(not (select rolcanlogin or rolbypassrls or rolsuper from pg_roles where rolname = 'wyp_rpc'), 'RPC role cannot log in, bypass RLS, or act as superuser');
select is((select count(*)::integer from pg_tables where schemaname in ('public','private') and tableowner in ('wyp_rpc','wyp_auth_sync')), 0, 'runtime roles own no application tables');
select ok(not (select rolcanlogin or rolbypassrls or rolsuper from pg_roles where rolname = 'wyp_auth_sync'), 'auth sync role cannot log in, bypass RLS, or act as superuser');
select ok(not has_schema_privilege('wyp_rpc', 'auth', 'USAGE'), 'RPC role does not depend on managed auth schema access');
select ok(not has_column_privilege('wyp_rpc', 'public.profiles', 'email_verified_at', 'UPDATE'), 'RPC role cannot forge confirmation status');
select ok(not has_column_privilege('wyp_auth_sync', 'public.profiles', 'role', 'UPDATE'), 'auth sync role cannot elevate creator capability');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anonymous cannot access private schema');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot access private schema');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'ordinary clients cannot update roles');
select ok(not has_function_privilege('anon', 'public.enable_creator()', 'EXECUTE'), 'anonymous cannot enable creator');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.proowner in ('wyp_rpc'::regrole,'wyp_auth_sync'::regrole)
    and (p.proconfig is null or not ('search_path=""' = any(p.proconfig)))
), 'every application RPC/helper pins an empty search path');
select ok(not has_column_privilege('wyp_rpc', 'auth.users', 'encrypted_password', 'SELECT'), 'RPC role cannot read password hashes');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('10000000-0000-4000-8000-000000000001','sql-a@example.test',now(),'{"role":"creator"}'),
('10000000-0000-4000-8000-000000000002','sql-b@example.test',now(),'{}'),
('10000000-0000-4000-8000-000000000003','sql-unverified@example.test',null,'{}');
select is((select role from public.profiles where user_id = '10000000-0000-4000-8000-000000000001'), 'learner', 'signup ignores injected creator metadata');
select ok(not exists (select 1 from auth.users u left join public.profiles p on p.user_id = u.id where p.user_id is null or p.email_verified_at is distinct from u.email_confirmed_at), 'bootstrap and auth inserts produce consistent trusted confirmation state');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.profiles), 1, 'caller can read only their own profile');
select throws_like($$update public.profiles set role = 'creator'$$, '%permission denied%', 'direct role mutation is denied');
select throws_like($$update public.profiles set email_verified_at = now()$$, '%permission denied%', 'client cannot forge email confirmation');
select is(public.enable_creator()->>'role', 'creator', 'verified learner can self-enable creator');
select is(public.enable_creator()->>'role', 'creator', 'repeated enable is idempotent');
select is((select count(*)::integer from public.profiles), 1, 'creator still sees only their own profile');
select throws_like($$select private.require_verified_user()$$, '%permission denied%', 'private helper cannot be invoked by caller');

select set_config('test.revocation_session', public.start_training_session('10000000-0000-4000-8000-000000000088')->'session'->>'id', true);
reset role;
update auth.users set email_confirmed_at = null where id = '10000000-0000-4000-8000-000000000001';
select is((select email_verified_at from public.profiles where user_id = '10000000-0000-4000-8000-000000000001'),null::timestamptz,'trusted auth update immediately revokes mirrored confirmation');
set local role authenticated;
select throws_ok($$select public.get_training_session(current_setting('test.revocation_session')::uuid)$$,'P0001','EMAIL_NOT_VERIFIED','existing caller JWT cannot read saved session after verification revocation');
select is((select count(*)::integer from public.training_sessions),0,'revoked verification also removes direct Data API training visibility');
reset role;
update auth.users set email_confirmed_at = now() where id = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_training_session(current_setting('test.revocation_session')::uuid)->>'phase','setup','trusted confirmation restoration permits saved play again');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok('select public.enable_creator()', 'P0001', 'EMAIL_NOT_VERIFIED', 'unverified account cannot enable creator');
select throws_ok($$select public.start_training_session('10000000-0000-4000-8000-000000000099')$$, 'P0001', 'EMAIL_NOT_VERIFIED', 'unverified account cannot start training');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.enable_creator()', 'P0001', 'AUTH_REQUIRED', 'missing identity cannot enable creator');
reset role;
select * from finish();
rollback;
