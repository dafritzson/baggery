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

Still open:

- What the ghost wins, e.g. a share of the pot.
- Pick order between the 2 managers in each draft, and what happens to a pick they don't make
  (autodraft?).
- How the Standings, tiebreakers and round closing handle a 4th team in round 3.

## Smoother tab switching on phones

Switching tabs feels slower than apps like Facebook. Looked at from the code on 2026-09-27; not
measured yet. `scripts/bench-tabs.mjs` times each tab tap against local Supabase (phone viewport,
4x CPU slowdown): time to settle, longest main-thread task, requests, and DOM nodes. Run it
before and after a change. Ideas, biggest first:

1. **The tabs are screens in a `Stack`** (`app/src/app/_layout.tsx`), and the tab bar
   (`components/section-nav.tsx`) uses `router.navigate`. In recent Expo Router, `navigate`
   seems to push a new screen instead of going back to one already open (not checked against the
   installed source; the benchmark's DOM node count going up round after round would confirm
   it). If so, every tap rebuilds the tab and forgets its state (scroll, Games' day,
   Research's filters), and old copies stay mounted, re-rendering on every score broadcast.
   Fix: Expo Router `Tabs` (or `expo-router/ui` headless tabs) with the existing
   `BottomTabBar` as its tab bar, so each tab mounts once and then only shows or hides.
2. **Data is mostly shared already:** `SeasonProvider` and `ScoresProvider` load once for the
   app, so Draft, Standings and Games fetch nothing on a switch. Their cost is rendering.
3. **Research** re-runs the `postseason_totals` RPC on every mount and renders the whole pool
   as a non-virtualized table. Cache the totals like the Almanac does, and virtualize the rows.
4. **Almanac** calls the `almanac` function on first visit (~100 KB est.), cached 5 minutes.
   Start the load on the tab's press-in, and/or keep a copy on the device and revalidate it.
   Prefetching on app start costs egress and invocations for every open (docs/LIMITS.md).
5. **Games** renders all three zoom views on mount. Real tabs pay that once; otherwise mount
   Round and Postseason just after the first paint.
6. **App open:** keep the last season data on the device and show it at once while it
   reloads (stale-while-revalidate). Same egress.
