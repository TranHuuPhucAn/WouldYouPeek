-- Authoring never owns tables and never receives managed auth-schema privileges.
grant execute on function private.current_user_id(),private.require_verified_user() to wyp_creator_rpc;
grant select on public.profiles to wyp_creator_rpc;
create policy profiles_creator_read on public.profiles for select to wyp_creator_rpc using(user_id=(select private.current_user_id()));
grant select,insert on public.scenarios to wyp_creator_rpc;
grant update(title,topic,current_version,is_published,updated_at,first_published_at,published_at) on public.scenarios to wyp_creator_rpc;
create policy scenarios_creator_read on public.scenarios for select to wyp_creator_rpc
  using(creator_id=(select private.current_user_id()) and not is_demo and (select private.creator_allowed()));
create policy scenarios_creator_insert on public.scenarios for insert to wyp_creator_rpc
  with check(creator_id=(select private.current_user_id()) and not is_demo and not is_published and current_version is null and (select private.creator_allowed()));
create policy scenarios_creator_update on public.scenarios for update to wyp_creator_rpc
  using(creator_id=(select private.current_user_id()) and not is_demo and (select private.creator_allowed()))
  with check(creator_id=(select private.current_user_id()) and not is_demo and (select private.creator_allowed()));
grant select,insert on public.scenario_versions,private.scenario_answer_keys to wyp_creator_rpc;
create policy versions_creator_read on public.scenario_versions for select to wyp_creator_rpc
  using(exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy versions_creator_insert on public.scenario_versions for insert to wyp_creator_rpc
  with check(exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy keys_creator_read on private.scenario_answer_keys for select to wyp_creator_rpc
  using(exists(select 1 from public.scenario_versions v join public.scenarios s on s.id=v.scenario_id where v.id=scenario_version_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy keys_creator_insert on private.scenario_answer_keys for insert to wyp_creator_rpc
  with check(exists(select 1 from public.scenario_versions v join public.scenarios s on s.id=v.scenario_id where v.id=scenario_version_id and s.creator_id=private.current_user_id() and not s.is_demo));
grant select,insert on private.scenario_drafts to wyp_creator_rpc;
grant update(revision,draft_revision,content,checksum,saved_at,updated_at,review_id) on private.scenario_drafts to wyp_creator_rpc;
grant select,insert on private.scenario_reviews,private.creator_commands to wyp_creator_rpc;
create policy drafts_creator_read on private.scenario_drafts for select to wyp_creator_rpc
  using(exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy drafts_creator_insert on private.scenario_drafts for insert to wyp_creator_rpc
  with check(exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy drafts_creator_update on private.scenario_drafts for update to wyp_creator_rpc
  using(exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo))
  with check(exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy reviews_creator_read on private.scenario_reviews for select to wyp_creator_rpc
  using(reviewer_id=private.current_user_id() and exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy reviews_creator_insert on private.scenario_reviews for insert to wyp_creator_rpc
  with check(reviewer_id=private.current_user_id() and exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));
create policy creator_commands_read on private.creator_commands for select to wyp_creator_rpc
  using(actor_id=private.current_user_id() and (select private.creator_allowed()));
create policy creator_commands_insert on private.creator_commands for insert to wyp_creator_rpc
  with check(actor_id=private.current_user_id() and exists(select 1 from public.scenarios s where s.id=scenario_id and s.creator_id=private.current_user_id() and not s.is_demo));

-- Transfer only this milestone's explicitly named functions. Existing learner/auth
-- functions retain their existing role and permissions, except the new shared start.
do $$ declare fn record; role_name text;
begin
  for fn in
    select p.oid::regprocedure signature,n.nspname,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname=any(array[
      'creator_allowed','require_creator','creator_trim','creator_object','creator_text','creator_text_list','creator_number','creator_issue','creator_youtube_id',
      'creator_content_checksum','empty_creator_draft','validate_creator_draft','normalize_creator_value','normalize_creator_content','encode_creator_cursor','decode_creator_cursor',
      'read_creator_snapshot','creator_summary','match_creator_command','record_creator_command','lock_creator_draft','project_creator_publication',
      'session_target','reject_session_target_change','session_summary','library_preview','start_target_session'])
      or n.nspname='public' and p.proname=any(array[
      'create_creator_scenario','get_creator_scenario','list_creator_scenarios','save_creator_scenario','get_creator_review_preview',
      'review_creator_scenario','publish_creator_scenario','unpublish_creator_scenario','list_library_previews','get_library_preview','start_selected_training_session'])
  loop
    role_name:=case when fn.proname=any(array['session_target','reject_session_target_change','session_summary','library_preview','start_target_session','list_library_previews','get_library_preview','start_selected_training_session']) then 'wyp_rpc' else 'wyp_creator_rpc' end;
    execute format('alter function %s owner to %I',fn.signature,role_name);
    execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
    if fn.nspname='public' then execute format('grant execute on function %s to authenticated',fn.signature); end if;
  end loop;
end $$;
grant execute on function private.creator_object(jsonb,text[]),private.creator_text(jsonb,integer),private.decode_creator_cursor(text),private.encode_creator_cursor(jsonb) to wyp_rpc;
revoke create on schema public,private from wyp_creator_rpc,wyp_rpc;

-- An explicit read-only privilege on new selection columns is already covered by
-- the existing table SELECT/INSERT grant. Neither clients nor RPC roles can update
-- a session's target; the trigger also protects maintenance mistakes.
revoke all on private.scenario_drafts,private.scenario_reviews,private.creator_commands from public,anon,authenticated;
