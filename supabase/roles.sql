-- Fresh local/shadow bootstrap only; hosted migration up does not apply this file.
-- CLI 3.2's disabled auto-exposure removes sequence USAGE/SELECT defaults, but
-- newly created hosted projects also remove UPDATE. Align that remaining default
-- without changing existing objects, application roles, or migration history.
alter default privileges for role postgres in schema public
  revoke update on sequences from anon, authenticated, service_role;
