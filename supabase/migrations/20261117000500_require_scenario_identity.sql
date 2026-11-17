-- SQL CHECK accepts NULL, so explicitly require both JSON identity fields to
-- compare true. This also protects future creator/import paths from partial JSON.
alter table public.scenario_versions drop constraint challenge_identity;
alter table public.scenario_versions add constraint challenge_identity check (
  (challenge->>'id' = scenario_id and challenge->>'contentVersion' = content_version) is true
);
