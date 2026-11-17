create table public.scenarios (
  id text primary key,
  title text not null,
  topic text not null,
  sort_order integer not null check (sort_order > 0),
  current_version uuid,
  is_published boolean not null default false,
  is_demo boolean not null default false
);
create table public.scenario_versions (
  id uuid primary key,
  scenario_id text not null references public.scenarios(id),
  content_version text not null,
  challenge jsonb not null check (jsonb_typeof(challenge) = 'object'),
  checksum text not null,
  created_at timestamptz not null default now(),
  unique (scenario_id, content_version),
  unique (id, scenario_id),
  constraint challenge_identity check (challenge->>'id' = scenario_id and challenge->>'contentVersion' = content_version),
  constraint safe_challenge_fields check (not (challenge ?| array['reveal','observedAction','analysis','outcomeText','takeaway','review','optionFeedback']))
);
alter table public.scenarios add constraint current_version_belongs_to_scenario foreign key (current_version, id) references public.scenario_versions(id, scenario_id) deferrable initially deferred;
create table private.scenario_answer_keys (
  scenario_version_id uuid primary key references public.scenario_versions(id),
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'object'),
  review jsonb not null
);

create function private.reject_immutable_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'IMMUTABLE_RECORD';
end;
$$;
alter function private.reject_immutable_change() owner to wyp_rpc;
revoke all on function private.reject_immutable_change() from public, anon, authenticated;
create trigger immutable_scenario_version before update or delete on public.scenario_versions for each row execute function private.reject_immutable_change();
create trigger immutable_answer_key before update or delete on private.scenario_answer_keys for each row execute function private.reject_immutable_change();

alter table public.scenarios enable row level security;
alter table public.scenarios force row level security;
alter table public.scenario_versions enable row level security;
alter table public.scenario_versions force row level security;
alter table private.scenario_answer_keys enable row level security;
alter table private.scenario_answer_keys force row level security;
revoke all on public.scenarios, public.scenario_versions, private.scenario_answer_keys from public, anon, authenticated;
grant select on public.scenarios, public.scenario_versions, private.scenario_answer_keys to wyp_rpc;
create policy scenarios_rpc_read on public.scenarios for select to wyp_rpc using (true);
create policy versions_rpc_read on public.scenario_versions for select to wyp_rpc using (true);
create policy keys_rpc_read on private.scenario_answer_keys for select to wyp_rpc using (true);

create function private.scenario_preview(p_challenge jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_challenge->'id', 'title', p_challenge->'title', 'topic', p_challenge->'topic',
    'order', p_challenge->'order', 'mediaStatus', p_challenge->'mediaStatus',
    'context', p_challenge->'context', 'source', p_challenge->'source', 'setup', p_challenge->'setup'
  ));
$$;
alter function private.scenario_preview(jsonb) owner to wyp_rpc;
revoke all on function private.scenario_preview(jsonb) from public, anon, authenticated;

create function public.list_scenario_previews() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.scenario_preview(v.challenge) order by s.sort_order, s.id), '[]'::jsonb)
  from public.scenarios s join public.scenario_versions v on v.id = s.current_version
  where s.is_published and s.is_demo;
$$;
create function public.get_scenario_preview(p_scenario_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.scenario_preview(v.challenge)
  from public.scenarios s join public.scenario_versions v on v.id = s.current_version
  where s.id = p_scenario_id and s.is_published and s.is_demo;
$$;
alter function public.list_scenario_previews() owner to wyp_rpc;
alter function public.get_scenario_preview(text) owner to wyp_rpc;
revoke all on function public.list_scenario_previews(), public.get_scenario_preview(text) from public, anon, authenticated;
grant execute on function public.list_scenario_previews(), public.get_scenario_preview(text) to anon, authenticated;
