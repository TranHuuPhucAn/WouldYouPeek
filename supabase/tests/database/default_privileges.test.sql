begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local role postgres;
select plan(23);

select ok(current_user = 'postgres', 'default-privilege probes are created by postgres');

-- These must be ordinary public objects: temporary objects would test pg_temp's
-- defaults instead. Every probe is removed by the transaction rollback below.
create table public.wyp_default_acl_probe_table(id integer);
create sequence public.wyp_default_acl_probe_sequence;
create function public.wyp_default_acl_probe_function() returns integer
language sql immutable as 'select 1';

-- Match the observed new-project profile, including the non-Data-API table
-- privileges. Effective checks also catch inherited/global default grants.
select is(array[
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'SELECT'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'INSERT'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'UPDATE'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'DELETE'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'TRUNCATE'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'REFERENCES'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'TRIGGER'),
  has_table_privilege(api.role_name, 'public.wyp_default_acl_probe_table', 'MAINTAIN')
], array[false,false,false,false,true,true,true,true],
  api.role_name || ' receives only the four residual privileges on a new public table')
from (values ('anon'::name), ('authenticated'), ('service_role')) api(role_name);

select ok(not has_function_privilege(api.role_name, 'public.wyp_default_acl_probe_function()', 'EXECUTE'),
  api.role_name || ' receives no execution privilege on a new public function')
from (values ('anon'::name), ('authenticated'), ('service_role')) api(role_name);

select is(array[
  has_sequence_privilege(api.role_name, 'public.wyp_default_acl_probe_sequence', 'USAGE'),
  has_sequence_privilege(api.role_name, 'public.wyp_default_acl_probe_sequence', 'SELECT'),
  has_sequence_privilege(api.role_name, 'public.wyp_default_acl_probe_sequence', 'UPDATE')
], array[false,false,false], api.role_name || ' receives no privilege on a new public sequence')
from (values ('anon'::name), ('authenticated'), ('service_role')) api(role_name);

select is(array[
  has_table_privilege('service_role', app.table_name, 'SELECT'),
  has_table_privilege('service_role', app.table_name, 'INSERT'),
  has_table_privilege('service_role', app.table_name, 'UPDATE'),
  has_table_privilege('service_role', app.table_name, 'DELETE'),
  has_table_privilege('service_role', app.table_name, 'TRUNCATE'),
  has_table_privilege('service_role', app.table_name, 'REFERENCES'),
  has_table_privilege('service_role', app.table_name, 'TRIGGER'),
  has_table_privilege('service_role', app.table_name, 'MAINTAIN')
], array[false,false,false,false,true,true,true,true],
  app.table_name || ' preserves the observed service-role privilege profile')
from unnest(array[
  'public.attempts', 'public.players', 'public.playlists', 'public.profiles',
  'public.scenario_versions', 'public.scenarios', 'public.training_session_items', 'public.training_sessions'
]) app(table_name);

select ok((
  select count(*) = 61 and bool_and(not has_function_privilege('service_role', p.oid, 'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.proowner in (
    'wyp_rpc'::regrole, 'wyp_auth_sync'::regrole, 'wyp_creator_rpc'::regrole,
    'wyp_video_rpc'::regrole, 'wyp_media_validator'::regrole, 'wyp_player_registry'::regrole,
    'wyp_playlist_fence'::regrole, 'wyp_moderation_rpc'::regrole, 'wyp_deployment_rpc'::regrole
  )
), 'all 61 application-owned public functions deny service-role execution');

select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'explicit authenticated profile access remains');
select ok(has_function_privilege('anon', 'public.list_scenario_previews()', 'EXECUTE'), 'explicit guest preview RPC access remains');
select ok(has_function_privilege('authenticated', 'public.enable_creator()', 'EXECUTE'), 'explicit authenticated creator RPC access remains');

select ok((
  select count(*) = 8 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
  from unnest(array[
    'public.attempts', 'public.players', 'public.playlists', 'public.profiles',
    'public.scenario_versions', 'public.scenarios', 'public.training_session_items', 'public.training_sessions'
  ]) app(table_name) join pg_class c on c.oid = app.table_name::regclass
), 'all eight application public tables retain forced row-level security');

select * from finish();
rollback;
