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
main   → deploy-staging (Supabase staging + Vercel staging URL)
       → deploy-production (waits for approval from @dafritzson) → Supabase prod + Vercel prod
```

- Supabase projects: staging `fysycochmsjicjephrid`, prod `xjbwsveifxhtdkpmnckr`.
- Secrets live only in the GitHub `staging` / `production` environments, and both are
  restricted to `main`. There are no repo-level secrets.
- Changes to `.github/` need review from the code owner (see `.github/CODEOWNERS`).

## Data model (summary)

- `leagues`, `league_members`: supports more than one friend group.
- `league_members`: who belongs to a league, and who is its commissioner (a role on the account).
- `seasons`: one per league per year, with its status.
- `fantasy_teams`: numbered spots in a season (`slot`). A signed-in user claims an open spot and
  names the team; `user_id` and `name` are nullable, so open spots and historical teams work.
  Unnamed spots show a random name in the app (`app/src/lib/team-name-list.ts`). `eliminated_after_round`.
- `mlb_teams`, `mlb_players`, `mlb_games`, `player_game_stats`: stats mirror of the MLB API.
- `season_player_pool`: who is draftable in a season, plus regular-season TB (for autodraft), PA, AB,
  games, H, 2B, 3B, HR, R, RBI, BB, SO, HBP, SF, SLG and OPS+ for the draft room table (AVG, OBP,
  OPS, TB/G, RDSLG, RDTB and TB·E[G]/162 are computed from them in the app, formulas in
  `core/stats.ts`). Which table columns show is each person's choice, saved in their browser. `season_mlb_teams` holds each team's wins and Wild Card bye.
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

## iOS app notes

Things to change when the iOS app (phase 4) gets built, because the web can only imitate them.

- **Tab bar glass.** The phone tab bar (`BottomTabBar` in `app/src/components/section-nav.tsx`)
  imitates Liquid Glass on the web: translucent fill, blur, a bright rim, a sheen, and in Chromium
  an SVG lens (`app/src/lib/liquid-lens.ts`). On iOS, render it with `GlassView` from
  `expo-glass-effect` (already a dependency) for Apple's real Liquid Glass on iOS 26, which also
  adapts its tint to what's behind it, so the per-page "over artwork" style isn't needed there.
  Keep the web version for the web.
