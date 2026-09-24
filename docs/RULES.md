# Baggery Rules (canonical)

This is the source of truth the app implements. It is the 2024 rules PDF plus every
clarification agreed since. When code and this file disagree, one of them is a bug.

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

xSLG, xwOBA, WAR and age were dropped as tiebreakers. They may come back later, but need to find good data sources for them.

## Drafts

| Draft | Before MLB series | Order | Kind |
|---|---|---|---|
| 1 | Wild Card | Random | Initial: 4-round snake |
| 2 | Division Series | Random (new) | Redraft |
| 3 | Championship Series | Fantasy round 1 ranking | Redraft (survivors only) |
| 4 | World Series | Fantasy round 2 ranking | Redraft (survivors only) |

- All drafts are snake drafts, up to 4 rounds.
- **Initial draft**: each pick adds a player. Every team ends with 4.
- **Redraft**: each pick drops any player on your roster and adds an undrafted player.
  A manager may **yield** instead, which skips them for the rest of that draft.
- **A player can be on one roster, ever, per season.** Once drafted he is off the board
  for good, including after being dropped, after his fantasy team is eliminated, and for
  the team that dropped him.
- **Stats stay with the team that earned them.** A player's stats count for a fantasy
  team only for games that start while he is on its roster. Stats already earned stay
  after he's dropped (e.g. Wild Card TB still count in round 1 after a DS redraft).
- **Draft pool**:
  - Draft 1: players on the active roster of a playoff team (postseason rosters aren't
    set yet). A drafted player left off the postseason roster scores 0 and can be
    replaced in the next redraft.
  - Redrafts: players on the postseason roster of an MLB team still alive, never
    previously drafted.
- **Pick lock**: picks lock at the first pitch of the first game of the next series.
  Unmade redraft picks become yields. Unmade initial-draft picks are autodrafted.
- Picks are not timed.

## Autodraft

- Available to any manager (and famously to Daniel Fritzson).
- Initial draft: picks the available player with the most regular-season TB.
- Redraft: drops the manager's players whose MLB team is eliminated and replaces each
  with the available player with the most regular-season TB. Yields when there's
  nothing left to replace. Replacing an injured player through autodraft needs a group
  vote, and the commissioner triggers it manually.

## Out of scope for now

- Money ($10 buy-in, winner takes all). A commissioner payment tracker comes later.
