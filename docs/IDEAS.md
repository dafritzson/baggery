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

RDTB regresses TB per game as a whole, which pulls playing time toward average along with
hitting skill. An alternative: RDSLG × (the player's AB per game) × E[G]. That regresses only
slugging and keeps each player's real at-bats per game (lineup spot, platoon, bench role).

### Coin-flip series odds

E[G] treats every game as 50/50. It could use team strength (e.g. regular-season win %) and home
field (the higher Wild Card seed hosts every game) for each team's chance to advance and
expected series length.

## Games tab calendar

Raised 2026-09-25. The Games tab picks a day from a dropdown. A calendar could replace it: open
on today's games, then zoom out to the week or the whole month to see the full postseason
schedule, with smooth zoom animations between day, week and month.
