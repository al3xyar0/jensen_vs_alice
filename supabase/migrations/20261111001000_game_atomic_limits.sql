-- Applied to the existing Hanara Supabase database, game_* objects only.
-- Extends game-only actions and makes per-user request counters atomic.
alter table public.game_rate_limits drop constraint if exists game_rate_limits_action_check;
alter table public.game_rate_limits add constraint game_rate_limits_action_check
  check (action in ('visit','start','events','submit'));

create or replace function public.game_consume_rate_limit(
  p_user uuid, p_action text, p_seconds integer, p_max integer
) returns boolean language plpgsql security invoker set search_path=public as $$
declare accepted boolean;
declare bucket timestamptz;
begin
  if p_action not in ('visit','start','events','submit')
     or p_seconds < 1 or p_max < 1 then
    return false;
  end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  insert into public.game_rate_limits(user_id,action,window_start,request_count)
  values(p_user,p_action,bucket,1)
  on conflict(user_id,action,window_start)
    do update set request_count=public.game_rate_limits.request_count+1
    where public.game_rate_limits.request_count < p_max
  returning true into accepted;
  return coalesce(accepted,false);
end; $$;
revoke all on function public.game_consume_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.game_consume_rate_limit(uuid,text,integer,integer) to service_role;
