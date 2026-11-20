begin;
grant create on schema public,private to wyp_rpc,wyp_creator_rpc;
create function private.playlist_query(p_query text) returns text language plpgsql immutable security definer set search_path='' as $$
declare normalized_query text;begin
 if p_query is null or length(p_query)>800 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 if private.playlist_text(p_query)='' then return '';end if;normalized_query:=private.normalize_player_key(p_query);
 if length(normalized_query)>100 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;return normalized_query;
end $$;
alter function private.playlist_query(text) owner to wyp_rpc;
revoke all on function private.playlist_query(text) from public,anon,authenticated;
grant execute on function private.playlist_query(text) to wyp_creator_rpc;
create function private.playlist_cursor(p_cursor text,p_kind text,p_filter jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare cur jsonb;dt timestamptz;uid uuid;begin
 if p_cursor is null then return null;end if;
 cur:=private.decode_creator_cursor(p_cursor);
 if not private.creator_object(cur,array['v','kind','filter','at','id']) or cur->'v'<>'1'::jsonb or cur->>'kind' is distinct from p_kind or cur->'filter' is distinct from p_filter
 or jsonb_typeof(cur->'at') is distinct from 'string' or length(cur->>'at')>50 or cur->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
 or jsonb_typeof(cur->'id') is distinct from 'string' or cur->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 dt:=(cur->>'at')::timestamptz;uid:=(cur->>'id')::uuid;return cur;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then raise exception using errcode='P0001',message='INVALID_REQUEST';
end $$;
create function private.playlist_public_preview(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'publicationVersion',v.id,'title',v.title,'description',v.description,'credit',v.credit,'players',v.players,'itemCount',(select count(*) from private.playlist_version_items i where i.publication_id=v.id),'publishedAt',v.published_at)
 from public.playlists p join private.playlist_versions v on v.id=p.current_version where p.id=p_id and private.playlist_publication_available(v.id);
$$;
create function private.playlist_public_detail(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select private.playlist_public_preview(p.id)||jsonb_build_object('items',(select jsonb_agg(i.preview order by i.position) from private.playlist_version_items i where i.publication_id=p.current_version)) from public.playlists p where p.id=p_id;
$$;
create function public.get_library_playlist(p_playlist_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:=private.playlist_public_detail(p_playlist_id);begin if result is null then raise exception using errcode='P0001',message='PLAYLIST_UNAVAILABLE';end if;return result;end $$;
create function public.list_library_playlists(p_query text default '',p_player_id uuid default null,p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q text:=private.playlist_query(p_query);filter jsonb;cur jsonb;rows jsonb;more boolean;next_at timestamptz;next_id uuid;begin
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 filter:=jsonb_build_object('query',q,'playerId',p_player_id);cur:=private.playlist_cursor(p_cursor,'library-playlists',filter);
 with page as (
 select p.*,row_number() over(order by p.first_published_at desc,p.id desc) n from public.playlists p
 where private.playlist_publication_available(p.current_version)
 and (p_player_id is null or exists(select 1 from private.playlist_version_players m where m.publication_id=p.current_version and m.player_id=p_player_id))
 and (q='' or exists(select 1 from private.playlist_version_players m join private.player_aliases a on a.player_id=m.player_id where m.publication_id=p.current_version and strpos(a.normalized_key,q)>0))
 and (cur is null or (p.first_published_at,p.id)<((cur->>'at')::timestamptz,(cur->>'id')::uuid)) order by p.first_published_at desc,p.id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.playlist_public_preview(id) order by n) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit,max(first_published_at) filter(where n=p_limit),(max(id::text) filter(where n=p_limit))::uuid into rows,more,next_at,next_id from page;
 return jsonb_build_object('playlists',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','library-playlists','filter',filter,'at',next_at,'id',next_id)) else null end);
end $$;
create or replace function public.get_library_player(p_player_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 select jsonb_build_object('id',p.id,'displayName',p.display_name) into result from public.players p where p.id=p_player_id and (
 exists(select 1 from private.scenario_version_players m join public.scenarios s on s.current_version=m.scenario_version_id where m.player_id=p.id and s.is_published and (s.is_demo or s.creator_id is not null))
 or exists(select 1 from private.playlist_version_players m where m.player_id=p.id and private.playlist_publication_available(m.publication_id)));
 return result;
end $$;
create function public.list_creator_playlists(p_status text default 'all',p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator();filter jsonb:=jsonb_build_object('status',p_status);cur jsonb;rows jsonb;more boolean;next_at timestamptz;next_id uuid;begin
 if p_status is null or p_status not in ('all','unpublished','published','withdrawn') or p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 cur:=private.playlist_cursor(p_cursor,'creator-playlists',filter);
 with page as(select p.*,row_number() over(order by p.created_at desc,p.id desc) n from public.playlists p where p.creator_id=actor and p.kind='creator'
 and(p_status='all' or p_status='unpublished' and p.current_version is null or p_status='published' and p.is_published or p_status='withdrawn' and p.current_version is not null and not p.is_published)
 and(cur is null or(p.created_at,p.id)<((cur->>'at')::timestamptz,(cur->>'id')::uuid)) order by p.created_at desc,p.id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.creator_playlist_summary(id) order by n) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit,max(created_at) filter(where n=p_limit),(max(id::text) filter(where n=p_limit))::uuid into rows,more,next_at,next_id from page;
 return jsonb_build_object('playlists',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','creator-playlists','filter',filter,'at',next_at,'id',next_id)) else null end);
end $$;
create function private.playlist_candidate_matches(p_version uuid,p_query text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.scenario_versions v where v.id=p_version and (
 strpos(lower(normalize(v.challenge->>'title',NFKC)),p_query)>0 or exists(select 1 from private.scenario_version_players m join private.player_aliases a on a.player_id=m.player_id where m.scenario_version_id=v.id and strpos(a.normalized_key,p_query)>0)));
$$;
alter function private.playlist_candidate_matches(uuid,text) owner to wyp_rpc;
revoke all on function private.playlist_candidate_matches(uuid,text) from public,anon,authenticated;
grant execute on function private.playlist_candidate_matches(uuid,text) to wyp_creator_rpc;
create function public.list_creator_playlist_scenarios(p_query text default '',p_cursor text default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.require_creator();q text:=private.playlist_query(p_query);filter jsonb;cur jsonb;rows jsonb;more boolean;next_at timestamptz;next_id text;begin
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='P0001',message='INVALID_REQUEST';end if;
 filter:=jsonb_build_object('query',q);cur:=private.playlist_cursor(p_cursor,'playlist-candidates',filter);
 with page as(select s.*,row_number() over(order by s.first_published_at desc,s.id desc) n from public.scenarios s join public.scenario_versions v on v.id=s.current_version
 where s.creator_id=actor and s.is_published and not s.is_demo and private.playlist_item_preview(v.id) is not null
 and (q='' or private.playlist_candidate_matches(v.id,q))
 and(cur is null or(s.first_published_at,s.id)<((cur->>'at')::timestamptz,cur->>'id')) order by s.first_published_at desc,s.id desc limit p_limit+1)
 select coalesce(jsonb_agg(private.playlist_item_preview(current_version) order by n) filter(where n<=p_limit),'[]'::jsonb),count(*)>p_limit,max(first_published_at) filter(where n=p_limit),max(id) filter(where n=p_limit) into rows,more,next_at,next_id from page;
 return jsonb_build_object('scenarios',rows,'nextCursor',case when more then private.encode_creator_cursor(jsonb_build_object('v',1,'kind','playlist-candidates','filter',filter,'at',next_at,'id',next_id)) else null end);
end $$;

-- Starter IDs/manifest are mirrored by the canonical fixture and checked by seed tests.
create function private.ensure_curated_starter_playlist() returns void language plpgsql set search_path='' as $$
declare pid uuid:='7ecf3523-18cb-5cbe-a307-5b5cd43d1836';vid uuid:='2e061c34-3f9c-58cd-8923-926b353662fc';
 ids text[]:=array['bind-clove-utility-window','bind-clove-smoke-contest','bind-clove-advantage-reset'];n integer;c integer;v public.scenario_versions;previews jsonb:='[]';v_content jsonb;v_players jsonb;v_credit jsonb:='{"kind":"editorial","displayName":"Would You Peek"}';
 title text:='TenZ — Three decisions on Bind';description text:='Three curated moments from TenZ’s Bind POV. Make your call, watch the action, then compare the analysis.';begin
 select count(*) into c from public.scenarios where id=any(ids);if c=0 then return;end if;if c<>3 then raise exception 'Original starter scenarios are incomplete';end if;
 for n in 1..3 loop
  select ver.* into v from public.scenario_versions ver join public.scenarios s on s.id=ver.scenario_id where s.id=ids[n] and s.is_demo and ver.content_version='vod-1';
  if not found or private.playlist_item_preview(v.id) is null then raise exception 'Original starter version or attribution is missing';end if;
  previews:=previews||jsonb_build_array(private.playlist_item_preview(v.id));
 end loop;
 v_content:=jsonb_build_object('title',title,'description',description,'items',(select jsonb_agg(jsonb_build_object('scenarioId',x->'scenarioId','scenarioVersion',x->'scenarioVersion') order by ord) from jsonb_array_elements(previews) with ordinality t(x,ord)));
 select jsonb_agg(player order by position) into v_players from(select distinct on(x->'player'->>'id') x->'player' player,ord position from jsonb_array_elements(previews) with ordinality t(x,ord) order by x->'player'->>'id',ord) t;
 if exists(select 1 from public.playlists where id=pid) then
  if not exists(select 1 from public.playlists p join private.playlist_versions pv on pv.id=p.current_version where p.id=pid and p.kind='editorial' and p.creator_id is null and pv.id=vid and pv.content=v_content and pv.credit=v_credit and pv.players=v_players and pv.checksum=md5(v_content::text))
  or (select jsonb_agg(i.preview order by i.position) from private.playlist_version_items i where i.publication_id=vid) is distinct from previews then raise exception 'Starter playlist differs from canonical manifest';end if;return;
 end if;
 insert into public.playlists(id,kind,is_published,first_published_at,published_at) values(pid,'editorial',true,'2026-11-21T00:00:00Z','2026-11-21T00:00:00Z');
 insert into private.playlist_versions(id,playlist_id,sequence,title,description,credit,players,content,checksum,published_at) values(vid,pid,1,title,description,v_credit,v_players,v_content,md5(v_content::text),'2026-11-21T00:00:00Z');
 for n in 1..3 loop
  select * into strict v from public.scenario_versions where scenario_id=ids[n] and content_version='vod-1';
  insert into private.playlist_version_items values(vid,n-1,v.id,v.scenario_id,private.current_scenario_availability_generation(v.scenario_id),previews->(n-1));
 end loop;
 insert into private.playlist_version_players select vid,(x->>'id')::uuid,x->>'displayName',(ord-1)::integer from jsonb_array_elements(v_players) with ordinality t(x,ord);
 update public.playlists set current_version=vid where id=pid;
end $$;
revoke all on function private.ensure_curated_starter_playlist() from public,anon,authenticated,wyp_rpc,wyp_creator_rpc;
select private.ensure_curated_starter_playlist();

do $$ declare f record;role_name text;begin
 for f in select p.oid::regprocedure sig,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 n.nspname='private' and p.proname=any(array['playlist_cursor','playlist_public_preview','playlist_public_detail'])
 or n.nspname='public' and p.proname=any(array['get_library_playlist','list_library_playlists','get_library_player','list_creator_playlists','list_creator_playlist_scenarios']) loop
 role_name:=case when f.proname in ('list_creator_playlists','list_creator_playlist_scenarios') then 'wyp_creator_rpc' else 'wyp_rpc' end;
 execute format('alter function %s owner to %I',f.sig,role_name);execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.nspname='public' then execute format('grant execute on function %s to authenticated',f.sig);if role_name='wyp_rpc' then execute format('grant execute on function %s to anon',f.sig);end if;end if;
 end loop;
end $$;
grant execute on function private.playlist_cursor(text,text,jsonb) to wyp_creator_rpc;
revoke create on schema public,private from wyp_rpc,wyp_creator_rpc;
commit;
