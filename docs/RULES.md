# Baggery Rules (canonical)

This is the source of truth the app implements. It is the 2024 rules PDF plus every
clarification agreed since. When code and this file disagree, one of them is a bug.

The app's Rules page (`app/src/app/(tabs)/rules.tsx`, from the account menu) is the players'
short version, and the help on Standings (`round-rules-sheet.tsx`) and in the draft room explains
a round or a ghost turn. Update them with this file when a rule changes.

## Vocabulary

- **Bag**: a base. Single = 1 bag, double = 2, triple = 3, home run = 4. A team's bags
  are its **Total Bases (TB)**.
- **Fantasy round**: a scoring period. Stats reset at the start of each one.
- **Draft**: the initial draft (Draft 1) or a redraft (Drafts 2–4).

## Teams

- A season has N fantasy teams (7 so far), each with exactly 4 MLB players.
- Only hitting stats count. Two-way players (e.g. Ohtani) count only for their hitting.

## Fantasy rounds

| Fantasy round | MLB series (game types) | Teams remaining after |
|---|---|---|
| 1 | Wild Card (`F`) + Division Series (`D`) | 5 |
| 2 | League Championship Series (`L`) | 3 |
| 3 | World Series (`W`) | 1 (champion) |

- Stats are assigned to a round by the game's series type, never by date.
- The lowest-ranked teams are eliminated at the end of each round.

## Ranking (tiebreakers in order)

1. Most TB
2. Highest SLG: team total, `sum(TB) / sum(AB)`
3. Highest OBP: team total, `sum(H+BB+HBP) / sum(AB+BB+HBP+SF)`
4. Most HR
5. Most R
6. Most RBI
7. Still tied → drink-off (any number of teams). The commissioner enters the result.

The Standings rank by this order all along, and a scales icon next to teams level on TB shows
how the tiebreakers separate them.

A round closes by itself once every MLB series in it has a winner and 3 hours have passed for
stat corrections: the teams below the cut are eliminated. The commissioner steps in only for a
drink-off (a full tie at the cut), whose winners they pick on the Standings page. They can also
reopen a round (a stat correction, say) until the draft after it starts; a reopened round waits
for them to close it again. Drafts 3 and 4 need the round before them closed.

xSLG, xwOBA, WAR and age were dropped as tiebreakers. They may come back later, but need to find good data sources for them.

## Drafts

| Draft | Before MLB series | Default order | Kind |
|---|---|---|---|
| 1 | Wild Card | Random | Initial: 4 rounds |
| 2 | Division Series | Random (new) | Redraft |
| 3 | Championship Series | Fantasy round 1 ranking | Redraft (survivors, then the ghost's 2 adds) |
| 4 | World Series | Fantasy round 2 ranking (the ghost included) | Redraft (finalists and the ghost) |

- Every draft is up to 4 rounds, a snake by default.
- **Draft settings**: the commissioner sets each draft's order and pattern, until the draft is
  complete. The order is set when the draft starts.
  - **Order**: random; by rank (best first, full ties shuffled); or by raffle. Draft 1 is
    random only. Draft 2 by rank follows the Wild Card games (bags and tiebreakers). Drafts 3 and
    4 by rank or raffle follow the round before them (round 1 or 2).
  - **Pattern**: snake (1..n, then n..1, ...) or circular (1..n every round).
  - **Raffle** (Drafts 3 and 4): the cut line is the bags of the best-ranked manager knocked out
    in that round. Each team ranked at or above that manager gets `bags − cut line + 1` raffle
    tickets, so a team that advanced on a tiebreaker or drink-off still gets 1. A team ranked
    below that manager (the ghost can be) gets none. Draw a ticket: its team picks first and its
    tickets leave the pot. Draw again for the second pick, and so on. Teams without tickets pick
    last. The server draws when the draft starts, and the draft room shows the tickets.
  - **Mid-draft changes**: changing the order draws a new one. A change is allowed only while
    every pick already made still falls on its team's turn (switching snake and circular is
    always fine in round 1); otherwise undo picks first.
- **Initial draft**: each pick adds a player. Every team ends with 4.
- **Empty spots**: when a hitter's MLB team is eliminated, he leaves his fantasy roster right
  then (keeping the bags he earned), and his spot is empty.
- **Redraft**: each pick adds an undrafted player, either into an empty spot or in place of any
  hitter on your roster (a hitter left off his team's postseason roster is replaced this way).
  A manager may **yield** instead, which skips them for the rest of that draft, but not while
  they have an empty spot (unless nobody undrafted is left). The same goes for passing a ghost
  turn.
- **Running out**: if the alive MLB teams' undrafted hitters run out, the managers still to
  pick yield and keep whoever they have, playing short.
  Burned players stay burned, and pitchers and hitters off the postseason roster stay out of the
  pool. A postseason roster change (an injury replacement) adds hitters once the pool is synced.
- **Burned players**: once drafted, a player is off the board for good, including after being
  dropped (he's **burned**), after his fantasy team is eliminated, and for the team that dropped
  him. The exception: a player dropped by a manager who's since been eliminated goes back in the
  pool once they're out, and anyone can draft him (the ghost too). The players still on an
  eliminated manager's roster stay off the board. A player is on one roster at a time; once
  someone redrafts a released player, the same rules apply to him again.
- **Stats stay with the team that earned them.** A player's stats count for a fantasy
  team only for games that start while he is on its roster. Stats already earned stay
  after he's dropped (e.g. Wild Card TB still count in round 1 after a DS redraft).
- **Draft pool**:
  - Draft 1: players on the active roster of a playoff team (postseason rosters aren't
    set yet), plus hitters on a playoff team's injured list (7, 10, 15 or 60-day) who could
    come off it before the postseason ends. They're marked as injured. A drafted player left
    off the postseason roster scores 0 and can be replaced in the next redraft.
  - Redrafts: players on the postseason roster of an MLB team still alive, not on a roster and
    not burned.
- **Pick lock**: picks lock at the first pitch of the first game of the next series.
  Unmade redraft picks become yields, except the ones that must fill an empty spot, which are
  autodrafted. Unmade initial-draft picks are autodrafted.
- Picks are not timed.

## Ghost team

The eliminated managers' team, so they keep following along. It's in the Standings from round 2.

- **Draft 3**: after the survivors' rounds, the 2 managers out after round 1 each add an undrafted
  hitter to the ghost, the higher-ranked of them first.
- **Round 2**: the ghost plays the Championship Series with those 2 hitters. It's never cut and
  doesn't take a spot: the cut counts only the managers' teams. The Standings still rank it with
  everyone, tiebreakers included, since its place sets its Draft 4 turn.
- **Draft 4**: the ghost drafts with the 3 finalists, placed by round 2 bags like everyone (by its
  rank, or its raffle tickets).
  Its first 2 turns fill its empty spots (no drop, no yield), made by the 2 managers out after
  round 2. Its last 2 are ordinary redraft picks, made by the 2 managers out after round 1, except
  that while the ghost has an empty spot, it fills it: no swap, no pass. Each
  pair goes higher-ranked first, so each of the 4 managers makes one turn. Unlike a manager's
  yield, a pass on a ghost turn (by the manager or autodraft) passes only that turn: the other
  manager still gets theirs. If nobody undrafted is left, an empty-spot turn is passed too (by
  the manager or autodraft), and the ghost plays short.
- **Round 3**: the ghost is ranked with the finalists. If it ranks first, it's the champion and
  its 4 managers share the title. A full tie with the top finalist is a drink-off (one of its
  managers drinks).
- A ghost pick its manager doesn't make is autodrafted (their autodraft switch, or the
  commissioner's autopick).
- The ghost goes by a 👻 for each manager behind it (👻👻 in round 2). The 2 managers out after
  round 2 join it as soon as round 2 closes, before Draft 4. No manager's team can be
  named "👻 Ghost" or only 👻s.
- The ghost wins about 6% of seasons (`scripts/ghost-sim.ts --ghost-in-cs`): with 2 hitters it
  finishes last in the CS 99% of the time, so it nearly always picks 4th and 5th in Draft 4.

## Autodraft

- Available to any manager (and famously to Daniel Fritzson).
- Initial draft: picks the available player with the most regular-season TB, passing over
  players on the injured list.
- Redraft: fills the manager's empty spots with the available players with the most
  regular-season TB. Yields when there's no empty spot left. Replacing an injured player through autodraft needs a group
  vote, and the commissioner triggers it manually.
- **Queue**: a manager who'd rather not leave it to TB can queue players for a draft, in order
  (the draft room's Queue tab, or Add to queue on a player). Autodraft, their switch or the
  commissioner's autopick, takes the top queued player still available first, even one on the
  injured list. In a redraft a queued player fills an empty spot, top of the queue first; the
  manager can instead have him replace a player on the roster. A queued player with no spot to fill is
  skipped. Once nobody in the queue can be taken, autodraft goes back to TB as
  above (in a redraft that means it yields, after filling any empty spots;
  the Queue tab says so). A queue is private: only its manager sees it. On a ghost turn it's the queue of the
  manager making it.

## Out of scope for now

- Money ($10 buy-in, winner takes all). A commissioner payment tracker comes later.
