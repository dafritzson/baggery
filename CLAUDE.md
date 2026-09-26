# Baggery

Fantasy baseball for the MLB postseason. Managers draft 4 hitters, bags (total bases)
decide who survives each round. Rules: [docs/RULES.md](docs/RULES.md). Plan and
architecture: [docs/PLAN.md](docs/PLAN.md). Free-tier limits: [docs/LIMITS.md](docs/LIMITS.md).
Ideas not yet decided on: [docs/IDEAS.md](docs/IDEAS.md).

## Layout

- `app/`: Expo app (web now, iOS later). Has its own [CLAUDE.md](app/CLAUDE.md) for Expo specifics.
- `supabase/migrations/`: Postgres schema. Never edit an applied migration; add a new one.
- `supabase/functions/`: Edge Functions (Deno). `draft` (all draft room actions, in one locked
  transaction), `sync-pool` (builds the draft pool from the MLB Stats API) and `player-stats`
  (a player's season, game log and past seasons for the player popup, from the MLB Stats API) and
  `poll-games` (live stats: mirrors postseason games and box scores into `mlb_games` and
  `player_game_stats`; pg_cron calls it every 10 seconds while a game is live, and the schedule and
  finished games only every 10 minutes otherwise), `almanac` (builds the league's Almanac from every
  season's rows in one request, so the app doesn't chain dozens of queries), and `import-season` (the commissioner imports a
  past season from the league's old Google Sheets; see the `import-season` skill).
- `supabase/functions/_shared/core/`: pure game logic (draft, scoring), shared by the
  functions and the app (`@core/...`). No dependencies; imports use `.ts` extensions.
- `tests/`: Vitest unit tests for the core.
- `scripts/history/`: reads past seasons' workbooks (in the gitignored `history/`), checks them
  against MLB data and writes the files `import-season` takes.

## Commands (repo root)

```bash
npm test                        # core unit tests
npm run typecheck               # core + app
npx supabase start              # local Supabase (needs Docker)
npx supabase functions serve    # local Edge Functions (keep running)
npm run test:int                # resets local DB, runs a full draft end to end
npx tsx scripts/seed-local.ts   # after `supabase db reset`: 7 test managers + player pool
```

Run the app locally against local Supabase (key from `npx supabase status`):

```bash
cd app && EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_KEY=<publishable key> \
  EXPO_PUBLIC_APP_ENV=local npx expo start --web
```

Locally the sign-in screen has a dev sign-in: `<manager>@example.com`, password `password123`
(e.g. `daniel@example.com`, the commissioner).

## Workflow

Changes reach users like this. Follow it for every change:

1. Work on a new branch. Never push to `main` directly.
2. Run `npm test`, `npm run typecheck`, and `cd app && npx expo lint` before pushing.
3. Open a PR and enable auto-merge (`gh pr merge --auto --squash`). When CI passes it
   merges and deploys to **staging** automatically.
4. Production deploys only after the repo owner approves the `production` environment
   in GitHub Actions. Never try to bypass or weaken that gate.

Resource limits: the app runs on free Supabase and Vercel plans, with Supabase quotas shared by
staging and production. Before changing polling or cron timing, realtime listeners or broadcasts,
Edge Function calls, what a live screen fetches, or stored files, read
[docs/LIMITS.md](docs/LIMITS.md), estimate the change's cost for a busy postseason month, say it
in the PR, and update that page. Egress (5 GB) and Edge Function invocations (500k) are the tight
ones. Don't use paid-only features.

Rule changes: update `docs/RULES.md` in the same PR as the code, and add tests in
`tests/` for any change to draft or scoring logic.
