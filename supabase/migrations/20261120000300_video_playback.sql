grant create on schema public to wyp_video_rpc;
create function public.authorize_video_playback(p_context jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_verified_user(); aid uuid; a private.video_assets; d private.scenario_drafts; s public.training_sessions; i public.training_session_items; v public.scenario_versions; answered boolean; k text:=p_context->>'kind'; phase text:=p_context->>'phase'; begin
 if k='creator-asset' then
  perform private.require_creator();
  if not private.creator_object(p_context,array['kind','assetId']) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  aid:=(p_context->>'assetId')::uuid;
  if not exists(select 1 from private.video_assets where id=aid and owner_id=actor) then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
 elsif k='creator-scenario' then
  perform private.require_creator();
  if not private.creator_object(p_context,array['kind','scenarioId','revision','phase']) or phase not in ('setup','reveal') or phase is null or jsonb_typeof(p_context->'revision') is distinct from 'number' then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select draft.* into d from private.scenario_drafts draft join public.scenarios sc on sc.id=draft.scenario_id where draft.scenario_id=p_context->>'scenarioId' and sc.creator_id=actor;
  if not found then raise exception using errcode='P0001',message='SCENARIO_NOT_FOUND'; end if;
  if d.revision::numeric<>(p_context->>'revision')::numeric then raise exception using errcode='P0001',message='SCENARIO_CONFLICT'; end if;
  if d.content->'source'->>'kind' is distinct from 'uploaded' then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
  aid:=(d.content->'source'->>'assetId')::uuid;
 elsif k='library-scenario' then
  if not private.creator_object(p_context,array['kind','scenarioId']) then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select ver.* into v from public.scenarios sc join public.scenario_versions ver on ver.id=sc.current_version where sc.id=p_context->>'scenarioId' and sc.is_published and sc.creator_id is not null;
  if not found then raise exception using errcode='P0001',message='SCENARIO_UNAVAILABLE'; end if;
  select asset_id into aid from private.scenario_version_assets where version_id=v.id;
 elsif k='session-item' then
  if not private.creator_object(p_context,array['kind','sessionId','itemId','phase']) or phase not in ('setup','reveal') or phase is null then raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
  select * into s from public.training_sessions where id=(p_context->>'sessionId')::uuid and user_id=actor;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
  select * into i from public.training_session_items where id=(p_context->>'itemId')::uuid and session_id=s.id and user_id=actor;
  if not found then raise exception using errcode='P0001',message='SESSION_NOT_FOUND'; end if;
  answered:=exists(select 1 from public.attempts where item_id=i.id and user_id=actor);
  if phase='reveal' and not answered or not answered and i.position is distinct from s.current_index then raise exception using errcode='P0001',message='VIDEO_NOT_FOUND'; end if;
  select asset_id into aid from private.scenario_version_assets where version_id=i.scenario_version_id;
 else raise exception using errcode='P0001',message='INVALID_REQUEST'; end if;
 select * into a from private.video_assets where id=aid and state='ready';
 if not found then raise exception using errcode='P0001',message='VIDEO_NOT_READY'; end if;
 if not exists(select 1 from storage.objects o where bucket_id=a.bucket and name=a.object_path and o.id::text||':'||coalesce(o.version,'')=a.object_version) then raise exception using errcode='P0001',message='MEDIA_UNAVAILABLE'; end if;
 return jsonb_build_object('assetId',a.id,'bucket',a.bucket,'objectPath',a.object_path);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;
alter function public.authorize_video_playback(jsonb) owner to wyp_video_rpc;
revoke all on function public.authorize_video_playback(jsonb) from public,anon,wyp_media_validator;
grant execute on function public.authorize_video_playback(jsonb) to authenticated;
revoke create on schema public from wyp_video_rpc;
