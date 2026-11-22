-- Read-only gate. Run against the explicitly selected hosted target after its
-- migrations and initial editorial seed. No repair or reset is performed.
begin read only;
do $$
begin
 if current_user <> 'postgres' then raise exception 'Trusted release administration required'; end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261123000100') then raise exception 'Launch migration is missing'; end if;
 if public.get_application_capabilities() is distinct from '{"sourceMode":"youtube-only"}'::jsonb then raise exception 'Hosted uploads must be disabled'; end if;
 if exists(select 1 from private.video_assets) or exists(select 1 from storage.objects where bucket_id='creator-vods')
    or exists(select 1 from private.media_validator_identity) then raise exception 'Hosted project contains local media or validator state'; end if;
 if exists(select 1 from pg_roles where rolname like 'wyp\_%' escape '\' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then raise exception 'Unsafe application role flags'; end if;
 if exists(select 1 from pg_tables where schemaname in ('public','private','auth','storage') and tableowner like 'wyp\_%' escape '\') then raise exception 'Application role owns a table'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)) then raise exception 'Application table lacks forced row-level security'; end if;
 if has_table_privilege('authenticated','private.deployment_settings','UPDATE') or has_table_privilege('wyp_deployment_rpc','private.deployment_settings','UPDATE')
    or pg_has_role('authenticator','wyp_deployment_rpc','MEMBER') then raise exception 'Deployment capability permissions drifted'; end if;
 if not exists(select 1 from storage.buckets where id='creator-vods' and not public) then raise exception 'Private media bucket configuration drifted'; end if;
 if (select count(*) from public.scenarios where is_demo)<>3 then raise exception 'Expected exactly three editorial scenarios'; end if;
 if exists(
  select 1 from (values
   ('bind-clove-utility-window','c12ec326-e97d-56ea-acd4-05909b25f8a5'::uuid,'33b97b2131f78066131e70d78d9f9cd447d4b3cafd4063c80f7bcf129c1dc7ee'),
   ('bind-clove-smoke-contest','186bf7ee-90bc-5c7a-a28c-471b5c76f3cc'::uuid,'26cf866f1262c7984e7ccb064c9b93bfcd4cab0137c3dd10797972a05d0e1f3e'),
   ('bind-clove-advantage-reset','3ca5f74a-4d22-5af2-a4b9-4204a0c8e1b9'::uuid,'1dd7bf471c6573917b87f64e8bd2e4949839764756d92292dd5581331c8f04da')
  ) expected(scenario_id,version_id,checksum)
  left join public.scenarios s on s.id=expected.scenario_id
  left join public.scenario_versions v on v.id=expected.version_id and v.scenario_id=s.id
  where s.id is null or not s.is_demo or v.content_version is distinct from 'vod-1' or v.checksum is distinct from expected.checksum
 ) then raise exception 'Canonical editorial source versions drifted'; end if;
 -- Existing operator holds and later immutable editorial republications are
 -- legitimate; verify the original publication without clearing those decisions.
 if not exists(select 1 from private.playlist_versions where id='2e061c34-3f9c-58cd-8923-926b353662fc' and playlist_id='7ecf3523-18cb-5cbe-a307-5b5cd43d1836')
    or (select count(*) from private.playlist_version_items where publication_id='2e061c34-3f9c-58cd-8923-926b353662fc')<>3 then raise exception 'Canonical starter playlist is missing'; end if;
end $$;
select 'hosted_ready';
commit;
