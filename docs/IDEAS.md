# Improvement ideas

Ideas we've talked about but not decided on. Nothing here is built. When one is picked up,
move it into the code (and `RULES.md` or `PLAN.md` if it changes them) and delete it here.

## Faster first visits to tabs

Tabs now stay mounted once opened (`app/src/components/section-nav.tsx`), so going back to a tab
skips React. On an iPhone 17 Pro it still takes 65–100 ms from tap to drawn (2026-10-04): React
~15 ms, then Safari putting a different page on screen, about 50 ms however the old one is hidden
or covered (tried content-visibility, display, visibility, opacity, transforms, z-order, a layer
per tab, containment). Fewer DOM nodes per tab is what's left to try there. What's left is each tab's first visit per app open, and on iPhone that's most
launches: iOS closes a Home Screen app that's been in the background a while.
`scripts/bench-tabs.mjs` times it (phone viewport, 4x CPU slowdown, the 2025 season, 80 ms taps):
Research ~255 ms to its first frame, Games ~100, Draft ~90, Almanac ~35 (then its data), Standings
~35. Ideas, biggest first:

1. **Research** draws all of its ~200 rows at once (about 5,000 DOM nodes, ~250 ms at 4x).
   Virtualize the rows. The name column is as wide as the longest name it has drawn, so drawing
   rows in batches instead would make it jump.
2. **Pre-render tabs** in idle time after the app opens: React's `<Activity mode="hidden">`
   renders at the lowest priority and runs no effects until shown. Adding each tab's DOM is one
   task that can't be split, though, which could make Home's bag game stutter while it happens.
   Not on the tab's press-in: iPhone Safari takes a tap that changes the page before the finger
   lifts for a hover and doesn't click, so the first tap on each tab did nothing (tried in #148).
3. **Almanac:** keep a copy on the device and show it while it reloads. Prefetching on app start
   costs egress and invocations for every open (docs/LIMITS.md).
4. **App open:** keep the last season data on the device and show it at once while it reloads
   (stale-while-revalidate). Same egress.

## Multiple leagues

Raised 2026-09-27: let other groups of friends run their own league, with each league's data
seen only by its members. Nothing decided; this is where things stand.

**Already league-scoped.** `leagues` → `seasons (league_id)` → teams, drafts, rosters and the
pool; `league_members` holds each league's roles and `league_managers` its past managers; a season
is unique per `(league_id, year)`. `requireCommissioner` checks the commissioner of that season's
league. The Almanac, past managers, season import and bag alerts already pass `league_id`. MLB data
(`mlb_games`, `player_game_stats`, `mlb_players`, `mlb_hits`), the poller and the scores broadcast
are shared by every league, as they should be, so polling costs the same for 1 league or 20.

**Assumes one league:**

1. Row-level security: every table's read policy is "any signed-in user" (`using (true)`). Each
   would become "a member of this league". This is the riskiest step (a mistake leaks a league or
   blanks our own screens) and needs a cross-league test per table and the owner's review.
2. `app/src/lib/season.ts` picks the newest season of all seasons. It needs a current league first.
3. Server jobs take the latest season across all leagues (`autoCloseRounds`, and `max(year)` in
   `poll-games`). They'd loop over each league's active season. Small, but it's round closing.
4. Our league, its 2026 season and the 7 spots are created by a migration (`season_setup.sql`),
   and the first to claim a spot becomes commissioner. New leagues need a create flow and a way
   to join (an invite link).
5. `bag_game_bests` is one leaderboard per user across the whole app: keep it or scope it by league.
6. The integration test and `scripts/seed-local.ts` hard-code our league's and season's IDs.

**Keeping onboarding simple.** Put the league in the link (e.g. `/t-baggery`), so someone in one
league (nearly everyone) never sees a picker; a switcher only appears for someone in 2 or more.
Join by the commissioner's invite link plus the current claim flow. A `public` flag per league keeps
ours viewable by anyone with the link, as now, with new leagues private by default. Keep one format:
only team count and survivors per round vary by league (RULES.md already says N teams), not scoring.

**Size.** Roughly a couple of weeks, done in the off-season: row-level security and its tests
first, then the current league in the app and server loops, then create and invite links. Polling
doesn't grow with leagues, but egress and function calls grow with users (docs/LIMITS.md); a
handful of groups should fit the free plans, a few dozen active ones likely need Pro.

**Alternatives.** A separate Supabase project and deployment per group runs the same code with no
security changes, but every deploy and migration runs N times and the free plan allows 2 projects,
so it fits about 1 more group. Don't ship the app changes without the row-level security change:
that's the one outcome where leagues can read each other's data.
