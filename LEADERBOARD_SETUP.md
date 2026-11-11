# Jensen vs Alice — Global leaderboard and analytics

## Current deployment state
- **Existing Supabase project:** Hanara (`rxpuzmguuseaogexovfg`) in `us-east-1`.
- **Database:** Game-only `public.game_*` tables and atomic rate-limit RPC are deployed and verified.
- **Edge Function:** `jva-game-api` version 2 is ACTIVE in Hanara; the function validates Supabase Auth JWTs itself.
- **GitHub:** The frontend and admin dashboard are staged on `feature/supabase-leaderboard-analytics`. **The public `main` game is unchanged.**
- **Tests:** Database object existence and RLS verified. Real anonymous sign-in, score submission, and live ranking have not yet passed browser end-to-end tests.

## Player experience (zero visible login)
1. Open the game and see the public Top 10 immediately.
2. Press START — no registration or account prompts, anonymous identity is provisioned silently by Supabase in the background.
3. After the game ends, type a nickname (1-20 characters), click SUBMIT SCORE, and receive a rank.
4. Viewing Top 100 never requires authentication. The admin dashboard is separate and restricted.

## One-time developer setting before live testing
1. In [Hanara authentication providers](https://supabase.com/dashboard/project/rxpuzmguuseaogexovfg/auth/providers), **enable Anonymous Sign-Ins** for invisible background score ownership. Players never see a login prompt. This is a project-wide setting, so review current Hanara auth behavior before enabling it. Existing Hanara row-level policies were inspected; no Hanara application policies have been changed.
2. Configure reasonable anonymous sign-in rate limits/CAPTCHA where supported. Edge-function per-user atomic rate limiting cannot stop attackers creating many new anonymous accounts.
3. For private admin access, enable email OTP/magic link for a permanent account and allow the eventual redirect `https://al3xyar0.github.io/jensen_vs_alice/online/admin.html`. After signing in as that permanent user and verifying their identity, grant only their UUID:

   ```sql
   insert into public.game_admins (user_id) values ('VERIFIED_ADMIN_AUTH_UID')
   on conflict (user_id) do nothing;
   ```

   Do not add anonymous users to `game_admins`. Knowing the static `online/admin.html` URL does not grant access to analytics; every metrics request is checked server-side against this table and verified non-anonymous Auth.
4. Test end-to-end on the feature branch before merging. For a local preview, serve the repository with an HTTP server on `localhost` so the Edge Function CORS permits it.

## Files
- `index.html`: Original game and minimal, non-blocking telemetry calls. No scoring, animation or gameplay changes.
- `online/config.js`: Hanara API URL and **publishable** browser key only. No secret credentials.
- `online/game-online.js`: Anonymous identity, Top 10 start screen, Top 100 leaderboard, filtered rankings, game-over score submission, X sharing, batched telemetry.
- `online/admin.html`: Private admin analytics frontend.
- `supabase/migrations/20261111000000_game_platform.sql`: Isolated database tables with RLS and disabled client table access.
- `supabase/migrations/20261111001000_game_atomic_limits.sql`: Atomic request limiting on game-only database objects.
- `supabase/functions/jva-game-api/index.ts`: Actual Edge Function deployed in Hanara.
- `supabase/config.toml`: JWT verified within the function, so gateway `verify_jwt=false`.

## API routes
`https://rxpuzmguuseaogexovfg.supabase.co/functions/v1/jva-game-api/`

- Public GET `leaderboard?range=all|week|today&limit=10|100`.
- JWT-protected POST `visit`, `start`, `events`, `submit`.
- Verified permanent admin GET `admin?days=7|30|90`.

## Security and privacy
- All game tables have RLS enabled and **no direct anonymous or authenticated table grants**; public leaderboard data comes through filtered server responses only.
- Anonymous users use Supabase Auth for ownership; no visible registration is required.
- Writes validate ownership, allowed events, bounded payloads, score plausibility, and per-account atomic request limits.
- Scores are **plausibility-checked, not cryptographically verified or cheat-proof**. Stronger anti-cheat requires a trusted server simulation or replay validation.
- No raw IP, email, precise location, or browser fingerprint is written to the game analytics tables. Supabase Auth separately processes normal authentication metadata.
- Keep project service keys in Supabase server-side environment only.

## Not ready for production yet
- Enable project-wide anonymous sign-in manually.
- Verify real page view, session start, completed game, score submission, global rank, and time filters.
- Grant and verify the specific permanent admin user.
- Run final Chrome/Safari/mobile tests and merge the feature branch only when they pass.
- Current admin aggregates are capped at 10k records per dataset; dashboard warns if results are sampled.
