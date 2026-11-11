-- Jensen vs Alice game backend: intentionally isolated game_* tables.
-- Run ONLY on the dedicated Supabase project for the game.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.game_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  visits integer not null default 0 check (visits >= 0),
  games_played integer not null default 0 check (games_played >= 0),
  nickname text check (nickname is null or char_length(nickname) between 1 and 20)
);

create table if not exists public.game_visits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  device text not null check (device in ('desktop','mobile','tablet')),
  utm_source text check (char_length(utm_source) <= 80),
  referrer_host text check (char_length(referrer_host) <= 120)
);
create index if not exists game_visits_time_idx on public.game_visits (occurred_at desc);
create index if not exists game_visits_user_idx on public.game_visits (user_id, occurred_at desc);

create table if not exists public.game_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  score integer check (score between 0 and 10000000),
  highest_wave smallint check (highest_wave between 1 and 10),
  final_valuation_b numeric(9,2) check (final_valuation_b between 0 and 5000),
  victory boolean,
  elapsed_seconds integer check (elapsed_seconds between 0 and 7200),
  outcome text check (outcome in ('bankruptcy','victory','abandoned')),
  constraint ended_fields check (ended_at is null or (score is not null and highest_wave is not null and final_valuation_b is not null))
);
create index if not exists game_sessions_user_idx on public.game_sessions (user_id, started_at desc);
create index if not exists game_sessions_started_idx on public.game_sessions (started_at desc);
create index if not exists game_sessions_wave_idx on public.game_sessions (highest_wave, ended_at desc);

create table if not exists public.game_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.game_sessions(id) on delete cascade,
  visit_id uuid references public.game_visits(id) on delete cascade,
  event_name text not null check (event_name in (
    'page_view','game_start','wave_start','wave_complete','market_shock','alice_hit',
    'jensen_hit','powerup_collected','boss_spawned','boss_defeated','game_over',
    'game_victory','score_submitted'
  )),
  properties jsonb not null default '{}'::jsonb check (jsonb_typeof(properties)='object' and pg_column_size(properties) <= 2048),
  occurred_at timestamptz not null default now()
);
create index if not exists game_events_session_idx on public.game_events (session_id, occurred_at);
create index if not exists game_events_name_time_idx on public.game_events (event_name, occurred_at desc);

create table if not exists public.game_score_submissions (
  session_id uuid primary key references public.game_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  score integer not null check (score between 0 and 10000000),
  highest_wave smallint not null check (highest_wave between 1 and 10),
  final_valuation_b numeric(9,2) not null,
  victory boolean not null,
  status text not null check (status in ('accepted','rejected')),
  reason text,
  submitted_at timestamptz not null default now()
);
create index if not exists game_score_submissions_user_idx on public.game_score_submissions (user_id, submitted_at desc);

-- One record per authenticated anonymous player; only their best accepted score.
create table if not exists public.game_leaderboard_scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid unique not null references public.game_sessions(id),
  nickname text not null check (char_length(nickname) between 1 and 20),
  score integer not null check (score between 0 and 10000000),
  highest_wave smallint not null check (highest_wave between 1 and 10),
  final_valuation_b numeric(9,2) not null,
  victory boolean not null,
  submitted_at timestamptz not null default now()
);
create index if not exists game_leaderboard_rank_idx on public.game_leaderboard_scores (score desc, highest_wave desc, submitted_at asc);

-- Only a verified permanent Supabase Auth user listed here can access the private dashboard.
create table if not exists public.game_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

-- Fixed-window counters; keys are server-derived auth user IDs, never untrusted IPs.
create table if not exists public.game_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('visit','start','events','submit')),
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, action, window_start)
);

-- Authenticated clients must access only the Edge Function. No public table access.
-- service_role bypasses RLS; Edge Functions verify user JWT and enforce ownership.
-- Keeping tables in public allows Edge Functions to use standard PostgREST with service credentials.
alter table public.game_players enable row level security;
alter table public.game_visits enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_events enable row level security;
alter table public.game_score_submissions enable row level security;
alter table public.game_leaderboard_scores enable row level security;
alter table public.game_admins enable row level security;
alter table public.game_rate_limits enable row level security;
revoke all on public.game_players, public.game_visits, public.game_sessions,
  public.game_events, public.game_score_submissions, public.game_leaderboard_scores,
  public.game_admins, public.game_rate_limits from anon, authenticated;

-- Retain ownership isolation and use explicit rate limiting in server code.
-- Optional scheduled maintenance: delete counters older than 2 days and events after your retention period.

-- Atomic server-only abuse gate; invoker is service_role, no public EXECUTE grant.
create or replace function public.game_consume_rate_limit(
  p_user uuid, p_action text, p_seconds integer, p_max integer
) returns boolean language plpgsql security invoker set search_path = public as $$
declare
  accepted boolean;
  bucket timestamptz;
begin
  if p_action not in ('visit','start','events','submit') or p_seconds < 1 or p_max < 1 then
    return false;
  end if;
  bucket := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
  insert into public.game_rate_limits(user_id, action, window_start, request_count)
    values (p_user, p_action, bucket, 1)
    on conflict (user_id, action, window_start) do update
    set request_count = public.game_rate_limits.request_count + 1
    where public.game_rate_limits.request_count < p_max
    returning true into accepted;
  return coalesce(accepted,false);
end; $$;
revoke all on function public.game_consume_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.game_consume_rate_limit(uuid,text,integer,integer) to service_role;