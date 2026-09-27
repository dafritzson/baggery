# Improvement ideas

Ideas we've talked about but not decided on. Nothing here is built. When one is picked up,
move it into the code (and `RULES.md` or `PLAN.md` if it changes them) and delete it here.

## Draft room projections

The RDSLG, RDTB and TB·E[G]/162 columns (formulas in
`supabase/functions/_shared/core/stats.ts`). Raised 2026-09-24.

### RDTB regresses much harder than RDSLG

Both add 200 of something to the player's season: 200 at-bats of .435 for RDSLG, 200 games of
1.5 TB for RDTB. 200 AB is about a third of a season, but 200 games is more than a full one,
so for RDTB the prior outweighs the player's own season. A full-season regular keeps about 76%
of their gap from average in RDSLG but only about 44% in RDTB. For example, Pete
Crow-Armstrong (2026: 159 G, 355 TB) goes from 2.23 TB/G to 1.82.

Regulars average about 3.6 AB per game, so ~55 games would match RDSLG's 200 AB. Unsure whether
the heavy regression is wanted, so it's unchanged.

### Expected games only fit Draft 1

E[G] is the expected games in fantasy round 1 as seen before the Wild Card. Later drafts
need something different:

- Draft 2 (before the Division Series): the Wild Card is over, so every surviving team
  expects 4.125 games.
- Drafts 3 and 4: best-of-7 series, 5.8125 expected games when every game is a coin flip.

E[G] could take the draft number, and the column could be labelled for the round it projects.

### Regress the skill, not the playing time

(xBags already works this way; the idea is to do the same for RDTB.)

RDTB regresses TB per game as a whole, which pulls playing time toward average along with
hitting skill. An alternative: RDSLG × (the player's AB per game) × E[G]. That regresses only
slugging and keeps each player's real at-bats per game (lineup spot, platoon, bench role).

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
