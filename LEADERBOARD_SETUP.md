# Jensen vs Alice — Online Leaderboard & Analytics

**Status: staged on `feature/supabase-leaderboard-analytics`, NOT live.** The game on `main` remains unchanged. Create a **new Supabase project** for this game; do not reuse the Signal15/Hanara databases.

## Architecture

- GitHub Pages continues serving the existing `index.html` game. New JS hooks are optional and never block the frame loop.
- `online/game-online.js` uses a *Supabase Auth anonymous session* to own a game session. No login screen for players. Auth identity comes from a verified JWT, not the locally generated visitor ID.
- `supabase/functions/game-api` is the only write/read API for game data. It verifies JWTs server-side with `auth.getUser` even though `verify_jwt=false` in config, and uses service credentials only inside the function.
- SQL enables RLS on every game table, grants **no browser direct table access**, and keeps public leaderboard output to nickname, rank, wave, score, and game stats.
- `online/admin.html` is a static admin shell, but private metrics only load if the caller has a **permanent Auth account** listed in `game_admins`. Merely knowing the URL grants no access.
- The score filter checks elapsed time, wave plausibility, and basic value ranges. **It is NOT cheat-proof or server-verified gameplay.** A determined attacker can forge results; robust verification requires a trusted server replay/authoritative simulation.

## Create the Supabase project (your next action)

1. Create a new Supabase project, e.g. **Jensen vs Alice**, in the organization you prefer. Projects may incur charges; review Supabase's quoted cost before confirming.
2. Send the **project reference** (the string in your project's URL `/project/<ref>`). **Do not send passwords, secret/service-role keys, or database credentials.** The connected Supabase app can discover the project and deploy it.
3. In Supabase Auth, turn on **Anonymous Sign-Ins** and configure abuse protection / CAPTCHA if available. Set a sensible sign-in rate limit.
4. Enable email OTP/magic-link login for your personal permanent admin user. Configure redirect `https://al3xyar0.github.io/jensen_vs_alice/online/admin.html`.
5. Schema: `supabase/migrations/20261111000000_game_platform.sql` (run on dedicated game project only).
6. Edge Function: deploy `supabase/functions/game-api/index.ts` under name `game-api` with JWT gateway verification disabled, because the function verifies its JWT itself. **Never disable the internal `auth.getUser` check.** Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to functions; never copy these keys into GitHub Pages.
7. In `online/config.js`, set your project's URL and its **publishable** (`sb_publishable_...`) key. These are intended to be public.
8. Create a permanent Supabase Auth user for yourself by using `online/admin.html` (email OTP). Once your user is created and email verified, grant that specific `auth.users.id` admin access:

   ```sql
   insert into public.game_admins (user_id) values ('YOUR_AUTH_USER_UUID');
   ```

9. Test as a visitor: open the feature-branch preview in a local HTTP server, start/finish a game, submit a score, check `game_leaderboard_scores` and `game_events`; check `/admin` rejects an anonymous player. Only then merge into `main` and let GitHub Pages deploy.

## Data retention / performance

- `game_visits`: one row per page load; `game_sessions`: one row per game; `game_events`: batched, meaningful events only.
- For small volume, the metrics Edge Function reads up to 10,000 rows per dataset. It explicitly flags results as sampled. For larger traffic, move aggregations into indexed SQL RPCs and add daily materialized summaries.
- Once settled, configure scheduled deletion of `game_rate_limits` entries older than two days and `game_events` older than your chosen retention period (e.g. 90 days). This code intentionally doesn't delete user data automatically.

## Files

- `index.html` — original game + small nonblocking analytics calls; no gameplay rewrite.
- `online/config.js` — placeholder until a project is selected.
- `online/game-online.js` — optional browser client and leaderboard UI.
- `online/admin.html` — private analytics dashboard shell.
- `supabase/migrations/*.sql` — RLS and isolated tables.
- `supabase/functions/game-api/index.ts` — ingestion, leaderboard, score submission, admin metrics.
- `supabase/config.toml` — Edge Function gateway setup.

## Limitations / follow-up work before production

- Current rate limiter is per-authenticated-user **best-effort**, not an atomic distributed limiter. Use an atomic SQL counter or gateway rate limit when scaling.
- Anonymous Auth creates durable temporary Auth users. Configure retention/cleanup policies; new browsers can create multiple accounts.
- Preventing cheating requires replay validation or a server-authoritative game engine. Mark results as *plausibility checked*, not cryptographically verified.
- Admin dashboard reports up to 10,000 recent rows per category and lacks the full advanced retention/valuation charts in the original brief. Expand after verifying real usage and event schemas.
- Test Chrome, Safari, and mobile manually after Supabase project credentials are connected. The branch is not a claim of complete end-to-end deployment.