-- Functions run as a narrowly granted role, never as a table owner or a bypass role.
-- Roles are cluster-wide and can outlive a local database reset.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'wyp_rpc') then
    create role wyp_rpc nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (select 1 from pg_roles where rolname = 'wyp_rpc' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Existing wyp_rpc role has unsafe attributes; review it before migrating.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'wyp_auth_sync') then
    create role wyp_auth_sync nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (select 1 from pg_roles where rolname = 'wyp_auth_sync' and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
    raise exception 'Existing wyp_auth_sync role has unsafe attributes; review it before migrating.';
  end if;
end;
$$;
-- PostgreSQL 17 requires SET membership for ownership transfer. Only the migration
-- executor receives it; browser/authenticator roles never do.
grant wyp_rpc to postgres with set true;
grant wyp_auth_sync to postgres with set true;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema public, private to wyp_rpc, wyp_auth_sync;
-- Needed only while transferring function ownership; revoked in the final migration.
grant create on schema public, private to wyp_rpc;
grant create on schema private to wyp_auth_sync;

-- PostgREST validates the JWT before setting these transaction-local claims.
-- Runtime roles need no grant or membership in Supabase's managed auth schema.
create function private.current_user_id() returns uuid
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub'
  )::uuid;
$$;
alter function private.current_user_id() owner to wyp_rpc;
revoke all on function private.current_user_id() from public, anon, authenticated;
-- Policies reference the stored function OID; private schema USAGE stays revoked.
grant execute on function private.current_user_id() to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'learner' check (role in ('learner', 'creator')),
  created_at timestamptz not null default now(),
  creator_enabled_at timestamptz,
  email_verified_at timestamptz,
  constraint creator_timestamp check ((role = 'learner' and creator_enabled_at is null) or (role = 'creator' and creator_enabled_at is not null))
);
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select on public.profiles to wyp_rpc;
grant update (role, creator_enabled_at) on public.profiles to wyp_rpc;
grant select (user_id, email_verified_at), insert (user_id, email_verified_at), update (email_verified_at) on public.profiles to wyp_auth_sync;
create policy profiles_read_own on public.profiles for select to authenticated, wyp_rpc using (user_id = (select private.current_user_id()));
create policy profiles_rpc_update on public.profiles for update to wyp_rpc using (user_id = (select private.current_user_id())) with check (user_id = (select private.current_user_id()));
-- GoTrue runs without a learner JWT. This trigger-only role can synchronize the
-- trusted confirmation column across accounts, but cannot change role/capabilities.
create policy profiles_auth_sync_read on public.profiles for select to wyp_auth_sync using (true);
create policy profiles_auth_sync_insert on public.profiles for insert to wyp_auth_sync with check (true);
create policy profiles_auth_sync_update on public.profiles for update to wyp_auth_sync using (true) with check (true);

create function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- User-editable metadata is deliberately ignored, including any injected role.
  if tg_op = 'INSERT' then
    insert into public.profiles(user_id, email_verified_at) values (new.id, new.email_confirmed_at);
  else
    update public.profiles set email_verified_at = new.email_confirmed_at where user_id = new.id;
  end if;
  return new;
end;
$$;
alter function private.handle_new_auth_user() owner to wyp_auth_sync;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert or update of email_confirmed_at on auth.users
for each row execute function private.handle_new_auth_user();

-- One-time bootstrap runs as the migration executor, never the runtime RPC role.
insert into public.profiles(user_id, email_verified_at)
select id, email_confirmed_at from auth.users
on conflict (user_id) do nothing;

create function private.require_verified_user() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare v_user uuid := private.current_user_id();
begin
  if v_user is null then raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where user_id = v_user and email_verified_at is not null) then
    raise exception using errcode = 'P0001', message = 'EMAIL_NOT_VERIFIED';
  end if;
  return v_user;
end;
$$;
alter function private.require_verified_user() owner to wyp_rpc;
revoke all on function private.require_verified_user() from public, anon, authenticated;

create function public.enable_creator() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_verified_user(); v_profile public.profiles;
begin
  update public.profiles set role = 'creator', creator_enabled_at = coalesce(creator_enabled_at, now())
  where user_id = v_user returning * into v_profile;
  if not found then raise exception using errcode = 'P0001', message = 'STORAGE_UNAVAILABLE'; end if;
  return jsonb_build_object('userId', v_profile.user_id, 'role', v_profile.role, 'createdAt', v_profile.created_at, 'creatorEnabledAt', v_profile.creator_enabled_at);
end;
$$;
alter function public.enable_creator() owner to wyp_rpc;
revoke all on function public.enable_creator() from public, anon, authenticated;
grant execute on function public.enable_creator() to authenticated;
