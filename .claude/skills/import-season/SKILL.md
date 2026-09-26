---
name: import-season
description: Read a past season's league workbook (the Google Sheet the league kept for 2020–2025) and check it against MLB data before importing it into Baggery. Use when adding, re-checking or fixing a historical season, or when asked how the old spreadsheets are laid out.
---

# Importing a past season

Before this app, each season was run from a Google Sheet. The workbooks live in `history/`
(gitignored, since the repo is public). Download a sheet with File → Download → Microsoft Excel
(.xlsx) and put it there. The year must be in the file name (`MLB 2024 Baggery.xlsx`,
`MLB_2021_Baggery_Sheet.xlsx`). The same folder has some years' rules docs (2020, 2024).

## Check a workbook

```bash
npx tsx scripts/history/check.ts            # every workbook in history/
npx tsx scripts/history/check.ts 2021       # one year
```

It prints one block per year and writes `history/<year>.json` (the season with MLB ids,
ready to import). MLB responses are cached in `history/.cache/`.

- Indented lines are notes: names matched by a rule rather than exactly (check they're the
  right player), survivors per round, the champion, and full ties at a cut line.
- `≠` lines are differences between the sheet and MLB box scores: typos, or games the
  commissioner never entered (2021 World Series Game 6). **MLB's numbers win.** These are
  only reported, as long as the same teams still advance.
- `✗` lines block the import: a name that matches no player (or several), a draft that
  doesn't replay to the lineup the manager's tab shows, or MLB's numbers ranked by the app's
  rules advancing different teams than actually advanced. Fix the name in `ALIASES` in
  `scripts/history/names.ts`, or ask the user.

## Import it

Signed in as the commissioner on the web app: Settings → Past seasons → choose one or more
`history/<year>.json` files → Import. For each, the `import-season` Edge Function writes the
season, teams (named after their manager), drafts and roster spells in one transaction (well
under a second). Then the card asks `sync-pool` to fill the player pool for the Draft and
Research tabs (every hitter on a postseason team's active roster the day before the Wild Card,
with that year's stats), and `poll-games` to load the postseason's games and box scores (a few
seconds each). Importing a year again replaces it; seasons played in the app, and any
year from the first one played in the app onward, are refused. Do it locally first
(`npx supabase db reset`, `npx supabase functions serve`, `npx tsx scripts/seed-local.ts`, dev
sign-in as `daniel@example.com`), then staging, then production.

Past teams belong to a `league_managers` row by first name. When a manager's row gets a
`user_id`, their teams in seasons imported after that get it too (re-import older ones).

Import policy (agreed with the league): rosters, drafts and eliminations come from the sheet,
because that's what happened. Bags come from MLB box scores.

## Workbook layout

Every year has the same tabs. Everything is found by its label, never by a fixed column,
because columns shift between years (2021 had a one-game Wild Card, so only `WC1`).

- **Live Scores**: a header row with `WC1…WC3 DS1…DS5 RD 1`, `CS1…CS7 RD 2`, `WS1…WS7 RD 3`.
  Each round's block lists the managers still alive in it (name in the column left of its
  first game column) with bags per game and the round total under `RD n`. Rows below
  (ranked lists, "Last Updated") are ignored. Round 1's list gives the season's managers.
- **Draft 1 … Draft 4**: a header row `Round | Pick | Fantasy Team | Player` (redrafts:
  `Drafted Player | Dropped Player`), one row per turn in the order made. A yield is `-`,
  `--`, `none` or blank. Pick numbers are inconsistent (some years keep the 7-team numbering
  after eliminations, and 2025's Draft 4 left out some yield rows), so only row order is used.
  Anything right of the draft table (player research, injury reports) is ignored.
- **One tab per manager**, named exactly as in Live Scores. Row 2 is the same kind of header.
  Each series has a block: player names in the column left of its first game column, then
  bags per game. Round 1 has two blocks, Wild Card and Division Series, because the DS redraft
  changes the lineup. A block ends at `Daily Total`. Blank means the player's team had no game
  or he didn't bat; 0 means he batted without a bag. Knocked-out managers' tabs may stop before
  the later series' columns. Notes below row 9 (AB counts for tiebreaks) are ignored.
- Other tabs (`tiebreak`, `SCRATCH`) are the commissioner's working notes.

Managers over the years: Alex, Curtis (2024–), Bill (2020–2022), Brian (2023), Daniel,
Darren, James, Kyle, Mookie. The league has only ever used first names, and no two managers
have shared one.

## Draft timing

Roster changes take effect at the first pitch of the series a draft was before (Draft 1 →
Wild Card, 2 → Division Series, 3 → Championship Series, 4 → World Series). That's the
draft's `locksAt` and the start or end of each roster spell, the same as a live season.
The check runs the app's own scoring (`teamRoundTotals`) on these spells, so a clean check
means the app will show the same standings.

## Name matching

Sheet names drop accents and suffixes, use nicknames, and have typos ("Eloy Jiminez",
"Wil Meyers", "Johnkensy Noel", "Profar"). Matching (`scripts/history/names.ts`) tries alias,
exact, first initial + last name, then a close spelling. A one-word name matches by last
name. Candidates are hitters on that year's postseason teams (full-season rosters plus
everyone in a postseason box score), preferring position players over pitchers with the
same name. A wrong match would show up as `≠` bag differences in every game for that
player, so a clean bag check also confirms the names.
