-- Run only through the local helper after it validates the owned local target.
-- This file is deliberately not part of seed.sql or any hosted migration.
begin;
do $$ begin
 if current_user <> 'postgres' then raise exception 'Trusted local administration required'; end if;
 if to_regclass('private.deployment_settings') is null then return; end if;
 if not exists(select 1 from private.deployment_settings where singleton) then raise exception 'Deployment capability row is missing'; end if;
 update private.deployment_settings set source_mode='youtube-and-upload' where singleton;
end $$;
commit;
