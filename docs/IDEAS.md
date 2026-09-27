# Improvement ideas

Ideas we've talked about but not decided on. Nothing here is built. When one is picked up,
move it into the code (and `RULES.md` or `PLAN.md` if it changes them) and delete it here.

## Ghost team for eliminated managers

Raised 2026-09-26, to keep eliminated managers following along. The 2 managers knocked out after
the Division Series each add a hitter at the end of the Championship Series redraft, after the
survivors; the 2 knocked out after the CS each add one in the World Series draft. Those 4 hitters
are the ghost team. It plays the 3 finalists in the WS round and wins the season if it beats all
3. The target is a 2–3% chance that the ghost wins.

The trigger: if the 4 eliminated managers' bags (Wild Card through CS) plus the bags the ghost's
CS picks earn in the CS beat the 3 finalists' bags, the ghost picks first in the WS draft.
Otherwise it picks after the finalists. A variant also lets the ghost replace CS picks whose MLB
team is out.

`scripts/ghost-sim.ts` estimates the odds: 620,000 simulated postseasons built from the 1995–2025
seasons, each played in today's 12-team bracket. The script describes the model and checks it
against the league's real seasons. Chance the ghost wins:

| | Ghost always picks last | With the trigger | Ghost always picks first |
|---|---|---|---|
| No redraft | 2.1% | 2.6% | 10% |
| Ghost redrafts dead CS picks | 2.8% | 4.0% | 19% |

The trigger fires in about 7% of seasons. With the trigger and no redraft, the ghost's chance
stays between 2.4% and 3.1% when the sim's assumptions change; with the redraft, between 3.3%
and 4.6%.

### Alex's version: hitters from the eliminated rosters

Raised 2026-09-27. Each eliminated manager gives the ghost one of their own hitters whose team is
still alive, instead of drafting one. A manager with none drafts an undrafted hitter with the last
pick of that draft, and so does a DS-out manager replacing a hitter knocked out in the CS (the
redraft version). There's no trigger. `npx tsx scripts/ghost-sim.ts --own-rosters`:

| | Chance the ghost wins |
|---|---|
| No redraft | 25% |
| DS-out managers redraft hitters knocked out in the CS | 33% |

That's about a fair fourth team's share, far over the 2–3% target, and it holds with only
2012–2025 seasons or each season's real bracket (24–26% and 32–34%). The ghost gets each
eliminated roster's best hitter who's still alive, which are drafted regulars, while each
finalist fills the slots its eliminated hitters leave from a thin undrafted pool. Its expected
bags per WS game (4.2, or 4.8 with the redraft) land between the finalists' (5.0, 4.4 and 3.6). An
eliminated manager has no hitter still alive about 5% of the time.

With a ghost of 2 (raised 2026-09-27, `--two-hitters`), each pair of eliminated managers gives 1
hitter: the 2 out after the DS give the best one still alive on either roster, then the 2 out
after the CS do the same. Otherwise it's the same as above.

| | Chance the ghost wins |
|---|---|
| No redraft | 3.2% |
| The DS-out pair redrafts a hitter knocked out in the CS | 3.6% |

That's just over the 2–3% target, and holds with only 2012–2025 seasons or each season's real
bracket (3.0–3.4% and 3.3–3.8%). A pair has no hitter still alive about 0.2% of the time.

Still open:

- What the ghost wins, e.g. a share of the pot.
- Pick order between the 2 managers in each draft, and what happens to a pick they don't make
  (autodraft?).
- How the Standings, tiebreakers and round closing handle a 4th team in round 3.

## Faster first visits to tabs

Tabs now stay mounted once opened (`app/src/components/section-nav.tsx`), so going back to a tab
takes a frame or two. What's left is each tab's first visit per app open, and on iPhone that's most
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
