create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phase text not null default 'setup' check (phase in ('setup', 'review', 'completed')),
  current_index integer default 0,
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id),
  constraint phase_checkpoint check (
    (phase = 'completed' and current_index is null and completed_at is not null) or
    (phase <> 'completed' and current_index is not null and current_index >= 0 and completed_at is null)
  )
);
create unique index one_active_session_per_user on public.training_sessions(user_id) where phase <> 'completed';
create index session_history_by_user on public.training_sessions(user_id, created_at desc, id desc);
create table public.training_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null,
  position integer not null check (position >= 0),
  scenario_version_id uuid not null references public.scenario_versions(id),
  foreign key (session_id, user_id) references public.training_sessions(id, user_id) on delete cascade,
  unique (session_id, position),
  unique (id, session_id, user_id)
);
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique,
  session_id uuid not null,
  user_id uuid not null,
  option_id text not null,
  answer_schema_version integer not null default 1 check (answer_schema_version = 1),
  answer jsonb not null check (jsonb_typeof(answer) = 'object'),
  answered_at timestamptz not null default now(),
  foreign key (item_id, session_id, user_id) references public.training_session_items(id, session_id, user_id) on delete cascade
);
create table private.session_commands (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation in ('start', 'answer', 'advance')),
  payload jsonb not null,
  payload_fingerprint text not null,
  session_id uuid not null,
  resulting_revision integer not null check (resulting_revision >= 0),
  created_session boolean,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id),
  foreign key (session_id, user_id) references public.training_sessions(id, user_id) on delete cascade
);

-- Frozen items and attempts may be cascade-deleted only with their auth account.
create trigger immutable_session_item before update on public.training_session_items for each row execute function private.reject_immutable_change();
create trigger immutable_attempt before update on public.attempts for each row execute function private.reject_immutable_change();
create trigger immutable_session_command before update on private.session_commands for each row execute function private.reject_immutable_change();

alter table public.training_sessions enable row level security;
alter table public.training_sessions force row level security;
alter table public.training_session_items enable row level security;
alter table public.training_session_items force row level security;
alter table public.attempts enable row level security;
alter table public.attempts force row level security;
alter table private.session_commands enable row level security;
alter table private.session_commands force row level security;
revoke all on public.training_sessions, public.training_session_items, public.attempts, private.session_commands from public, anon, authenticated;
grant select on public.training_sessions, public.training_session_items, public.attempts to authenticated;
grant select, insert on public.training_sessions, public.training_session_items, public.attempts, private.session_commands to wyp_rpc;
grant update (phase, current_index, revision, updated_at, completed_at) on public.training_sessions to wyp_rpc;
create policy sessions_read_own on public.training_sessions for select to authenticated, wyp_rpc using (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy sessions_rpc_insert on public.training_sessions for insert to wyp_rpc with check (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy sessions_rpc_update on public.training_sessions for update to wyp_rpc using (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null)) with check (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy items_read_own on public.training_session_items for select to authenticated, wyp_rpc using (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy items_rpc_insert on public.training_session_items for insert to wyp_rpc with check (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy attempts_read_own on public.attempts for select to authenticated, wyp_rpc using (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy attempts_rpc_insert on public.attempts for insert to wyp_rpc with check (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy commands_rpc_read on private.session_commands for select to wyp_rpc using (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
create policy commands_rpc_insert on private.session_commands for insert to wyp_rpc with check (user_id = (select private.current_user_id()) and exists (select 1 from public.profiles p where p.user_id = (select private.current_user_id()) and p.email_verified_at is not null));
