-- Service-role permissions for game-only tables (Hanara project).
-- RLS remains enabled; anon and authenticated roles retain no direct table grants.
grant select, insert, update, delete on table
  public.game_players,
  public.game_visits,
  public.game_sessions,
  public.game_events,
  public.game_score_submissions,
  public.game_leaderboard_scores,
  public.game_admins,
  public.game_rate_limits
to service_role;
