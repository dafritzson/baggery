# Baggery App Plan

Game rules: [RULES.md](RULES.md).

## Stack

| Layer | Choice |
|---|---|
| App | Expo (React Native + Expo Router, TypeScript) in `app/`. It ships as a web app now and an iOS app later. |
| Backend | Supabase (Free plan; limits in [LIMITS.md](LIMITS.md)): Postgres, Auth (email code + Google), Realtime, Edge Functions (Deno), cron, Storage (profile photos, public `avatars` bucket, 5 MB) |
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
- Once staging is deployed, the deploy comments on the merged PR, mentioning the repo owner, with the staging URL and a link
  to the run where production is approved. A newer deploy cancels older ones still waiting for
  approval, so only the newest waits.
- Changes to `.github/` need review from the code owner (see `.github/CODEOWNERS`).

## Data model (summary)

- `leagues`, `league_members`: supports more than one friend group.
- `league_members`: who belongs to a league, and who is its commissioner (a role on the account).
- `seasons`: one per league per year, with its status. `imported_at` marks past seasons imported
  from the old Google Sheets (2020–2025); only those can be re-imported.
- `league_managers`: everyone who has managed in the league, by first name. Every team points to its
  manager (`fantasy_teams.manager_id`): imported teams from the sheets, app-played teams from the
  claiming account's link (the commissioner links accounts in Settings → Past managers).
- `fantasy_teams`: numbered spots in a season (`slot`). A signed-in user claims an open spot and
  names the team; `user_id` and `name` are nullable, so open spots and historical teams work.
  Unnamed spots show a random name in the app (`app/src/lib/team-name-list.ts`). `eliminated_after_round`.
- `mlb_teams`, `mlb_players`, `mlb_games`, `player_game_stats`: stats mirror of the MLB API.
- `season_player_pool`: who is draftable in a season, plus regular-season TB (for autodraft), PA, AB,
  games, H, 2B, 3B, HR, R, RBI, BB, SO, HBP, SF, SLG and OPS+ for the draft room table (AVG, OBP,
  OPS, TB/G, RDSLG, RDTB and TB·E[G]/162 are computed from them in the app, formulas in
  `core/stats.ts`). Once the postseason has games, the table also shows Post PA and Post TB, summed
  from `player_game_stats` by `postseason_totals()` (up to a finished draft's lock), and drops
  Bye, which only matters for Draft 1.
- Team odds (`core/odds.ts`), computed in the app from each team's seed and wins
  (`season_mlb_teams`, set by `sync-pool`) and the series so far: regular-season win % shrunk
  toward .500 by 70 games, log5 plus a small home edge per game, the real series formats and
  home-field patterns, and MLB's fixed bracket. The draft table shows **Adv%** (his team's chance
  to get through the current fantasy round: reach the LCS in round 1, which a Wild Card team does
  by winning two series) and **xBags** (expected TB for the rest of the postseason: RDSLG ×
  his AB per game × his team's expected games left). Both are hidden without a full 6 seeds per
  league, so re-sync the pool after the seeds exist.
- Platoons and batting order (`core/platoon.ts`, `core/matchups.ts`). `sync-pool` reads each
  postseason team's regular-season lineups and starters (one `/schedule?teamId=…&hydrate=lineups,
  probablePitcher` per team; the probable pitcher is kept after the game and is who started) and
  stores, per hitter, his starts and lineup spots against left- and right-handed starters (recent
  games weighted more, half-life 30 days) and his splits against each hand
  (`season_player_pool.platoon`, `bat_side`), and each team's likely rotation: the 4 pitchers with
  the most starts in its last 30 days (`season_mlb_teams.rotation`). `poll-games` keeps the
  announced starters of postseason games in `mlb_probables`. With these, xBags becomes RDSLG × AB
  per PA × expected PA, where expected PA sums, over his team's likely games, the chance of each
  hand starting × his chance to start against it × the PA a game at his usual spot against it
  (MLB's 2026 averages, 4.63 leading off down to 3.75 batting 9th), plus a little for bench games.
  Games this round use the announced or rotation starters; later ones a league-average 27% lefties.
  The table's **Spot** column shows his usual spot ("2 · 7" when it differs by hand), and a
  platoon hitter (40+ points likelier to start against one hand) gets a `vs L`/`vs R` chip whose
  hover card shows his splits and the round's likely starters. The player popup's **Matchups this
  round** shows each game's likely starter and his chance to start. Hitters without lineups (no
  sync since this shipped) keep the old xBags. Traded hitters' starts count their current team's
  games only. Which table columns show is each person's choice, saved in their browser. `season_mlb_teams` holds each team's wins and Wild Card bye.
- `drafts`, `draft_actions`: every pick or yield, numbered. `unique(draft_id, action_number)`
  prevents double picks.
- `roster_spells`: (team, player, from, to) intervals. `unique(season_id, mlb_player_id)`
  enforces "one roster ever". Stats count when `game.start_time` falls inside a spell.

## Export

Settings → Export saves the season picked in the top bar as `baggery-<year>-exported-<date>.json`, in the same
format the Past seasons import takes (`exportSeason` in `core/season-import.ts`): managers (and
team names), every draft's order and picks, and who went out when, with the players and MLB
teams they name. That's everything the league enters; games and stats are MLB's and load again.
A finished season's file imports again.

## Hit videos

`mlb_hits` keeps every postseason hit's play: batter, type, inning and the play ID of the pitch
put in play, from MLB's play-by-play. Baseball Savant has a video of every pitch by play ID
(`baseballsavant.mlb.com/sporty-videos?playId=…`), published in a batch 13–25 hours after the game
(`poll-games` checks one hit per game hourly from 12 hours after first pitch and sets
`savant_ready` for the game's hits; until then the link is hidden), and MLB posts official clips of many hits
(all home runs we've checked, about half the doubles, few singles) whose `guid` is the play ID;
`poll-games` stores the clip's slug (`mlb.com/video/<slug>`) once it's posted, usually a minute or
two after a big hit in a big game, later in others. On Games, ▶ on a hitter lists his hits in
that game with both links, which open in the browser (nothing is embedded or stored). Settings
→ Games reloads a season's games and videos (commissioner).

The Games tab's bags come from the same hits: one emoji per TB, hit by hit in order, every bag of
a hit alike and never the previous hit's (`hitBags` in `core/bag-celebration.ts`). So the scores
load and broadcast carry rostered players' hits.

## Phases

| Phase | Deadline | Scope |
|---|---|---|
| 0 | Now | Repo layout, deploy pipeline, schema, draft/scoring core with tests |
| 1 | Draft 1, Mon 2026-09-28 | Login, season/manager setup, player pool import, random order, live snake draft, rosters |
| 2 | During Wild Card | Live stats poller (10s), standings with tiebreakers, per-player breakdown |
| 3 | Before DS redraft | Redrafts (drop+add, yield, lock at first pitch), eliminations, standings-based order, autodraft |
| 3.5 | Done | 2020–2025 history imported from the Google Sheets (Settings → Past seasons) |
| 3.6 | Now | Almanac tab: champions, records, careers, head-to-head, scouting stats and badges (`core/almanac.ts`). Next: more stats |
| 3.7 | Now | Bag alerts: web push when a hitter gets a bag (Settings → Bag alerts; Android browsers, iPhone from the Home Screen), with a spoiler delay. Sub alerts (👀 off the bench, 😠 replaced, from the box score) and cut alerts (🥵 on the hot seat, 😮‍💨 off the chopping block, after each game ends) go with them, each with its own switch (`core/game-alerts.ts`). Bag celebrations: bag emoji rain and a "You got 2 bags!" popup in the app (`core/bag-celebration.ts`), also on tapping an alert |
| 3.8 | Now | Standings time slider: a season chart with a slider under the table that moves the standings to any moment, day by day or bag by bag, with playback (`core/timeline.ts`). 2020–2024 hits backfilled from MLB's play-by-play (`scripts/history/hits.ts`); every play's batting lines too (`mlb_play_lines`, `scripts/history/play-lines.ts`), so mid-game moments have exact tiebreakers |
| 4 | Later | Chat, money tracker, iOS app via EAS |

## iOS app notes

Things to change when the iOS app (phase 4) gets built, because the web can only imitate them.

- **Tab bar glass.** The phone tab bar (`BottomTabBar` in `app/src/components/section-nav.tsx`)
  imitates Liquid Glass on the web: translucent fill, blur, a bright rim, a sheen, and in Chromium
  an SVG lens (`app/src/lib/liquid-lens.ts`). On iOS, render it with `GlassView` from
  `expo-glass-effect` (already a dependency) for Apple's real Liquid Glass on iOS 26, which also
  adapts its tint to what's behind it, so the per-page "over artwork" style isn't needed there.
  Keep the web version for the web. The selected tab's bubble slides with a CSS transition
  (`data-tab-bubble` in `app/src/global.css`), which native ignores, so it just jumps there:
  animate it with Reanimated, or use the native tab bar.
- **Hidden tabs.** Tabs stay mounted once opened, and on the web the ones not on show are hidden
  with CSS `content-visibility` (`TabScreen` in `section-nav.tsx`). Native needs nothing: the tab
  navigator detaches inactive screens with react-native-screens.
- **Live game ring.** Live games on the Games tab get a spinning rainbow ring, which is CSS in
  `app/src/global.css` (`data-live-glow`). Native ignores it, so draw it there too, e.g. a
  rotating `expo-linear-gradient` behind the card or a Skia sweep gradient.
- **Games zoom.** Switching the Games tab between Day, Round and Postseason zooms in or out, and
  the tapped game morphs into its card, using the browser's View Transitions
  (`app/src/lib/zoom.web.ts` and `global.css`). Native just switches (`zoom.ts`); animate it
  there with Reanimated, e.g. a shared element transition from the game square to its card.
- **Bag alerts.** They're web push (`app/src/lib/push.web.ts`, `app/public/sw.js`); native offers
  none (`push.ts`). On iOS, register with `expo-notifications` and save the Expo push token next
  to `push_subscriptions`, then have `poll-games/alerts.ts` send those through Expo's push
  service. The queues (`private.bag_alerts`, `private.push_queue`) and the alert text
  (`core/bag-alerts.ts`, `core/game-alerts.ts`) stay as they are. Tapping a bag alert opens
  `/games?bag=...`, which shows its bag celebration: open the alert's link from the notification
  there too (`expo-notifications` response listener), and read the spoiler delay from wherever the Expo token is kept (`pushDelaySeconds` in `push.ts`).
