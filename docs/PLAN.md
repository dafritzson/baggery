# Baggery App Plan

Game rules: [RULES.md](RULES.md).

## Stack

| Layer | Choice |
|---|---|
| App | Expo (React Native + Expo Router, TypeScript) in `app/`. It ships as a web app now and an iOS app later. |
| Backend | Supabase: Postgres, Auth (email code + Google), Realtime, Edge Functions (Deno), cron |
| Game logic | Pure TypeScript in `supabase/functions/_shared/core/`, shared by the Edge Functions and the app, with unit tests in `tests/` |
| Web hosting | Vercel, deployed from GitHub Actions |
| Stats | MLB Stats API (`statsapi.mlb.com`), polled every ~10s while games are live |

## Environments and deploy flow

```
branch → PR → CI (typecheck + tests) → auto-merge to main
main   → deploy staging → opens/updates the "Release to production" PR (main → production)
merge release PR (owner only, merge commit) → production branch → deploy production
```

- Supabase projects: staging `fysycochmsjicjephrid`, prod `xjbwsveifxhtdkpmnckr`.
- Secrets live only in the GitHub `staging` / `production` environments. `staging` is
  restricted to `main`, `production` to the `production` branch. There are no repo-level secrets.
- Only the repo owner can update `production` (ruleset), so merging the release PR is the
  approval. It works from the GitHub mobile app.
- Changes to `.github/` need review from the code owner (see `.github/CODEOWNERS`).

## Data model (summary)

- `leagues`, `league_members`: supports more than one friend group.
- `seasons`: one per league per year. Holds the commissioner and status.
- `fantasy_teams`: a manager's team in a season. `user_id` is nullable so historical or
  not-yet-signed-up managers work; `eliminated_after_round`.
- `mlb_teams`, `mlb_players`, `mlb_games`, `player_game_stats`: stats mirror of the MLB API.
- `season_player_pool`: who is draftable in a season, plus regular-season TB for autodraft.
- `drafts`, `draft_actions`: every pick or yield, numbered. `unique(draft_id, action_number)`
  prevents double picks.
- `roster_spells`: (team, player, from, to) intervals. `unique(season_id, mlb_player_id)`
  enforces "one roster ever". Stats count when `game.start_time` falls inside a spell.

## Phases

| Phase | Deadline | Scope |
|---|---|---|
| 0 | Now | Repo layout, deploy pipeline, schema, draft/scoring core with tests |
| 1 | Draft 1, Mon 2026-09-28 | Login, season/manager setup, player pool import, random order, live snake draft, rosters |
| 2 | During Wild Card | Live stats poller (10s), standings with tiebreakers, per-player breakdown |
| 3 | Before DS redraft | Redrafts (drop+add, yield, lock at first pitch), eliminations, standings-based order, autodraft |
| 4 | Later | Bag notifications (with optional spoiler delay), chat, 2020–2025 history import from Google Sheets, money tracker, iOS app via EAS |
