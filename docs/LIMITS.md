# Free-tier limits

Baggery runs on free plans. Supabase Free doesn't bill for overages, but it warns and can then
restrict the projects, so running over during the postseason would take the app down. Check this
page before any change that adds polling, realtime traffic, Edge Function calls, stored files or
bigger downloads.

**Supabase quotas are per organization, not per project.** Staging and production share them,
and both run the poller.

## Supabase

| Limit | Free plan | Our usage (estimated) | Status |
|---|---|---|---|
| API requests | Unlimited | | ✅ |
| Monthly active users | 50,000 | ~12 managers plus a few spectators | ✅ |
| Database size | 500 MB | Under 20 MB even after several seasons: a postseason is ~45 games and ~1,500 batting lines, plus the pool and draft | ✅ |
| File storage | 1 GB | Profile photos, ~15 KB each (256 px JPEG): under 1 MB for the league | ✅ |
| Egress | 5 GB / month | Low after the scores broadcast (see below). This is the one to watch | ⚠️ |
| Cached egress (CDN) | 5 GB / month | Photos only, ~5 MB / month | ✅ |
| Edge Function invocations | 500k / month | ~120–150k per project in a busy postseason month, so ~250–300k for staging plus production | ⚠️ |
| Realtime concurrent connections | 200 | One per open app | ✅ |
| Realtime messages per second | 100 | One broadcast per poll, per open app | ✅ |
| Realtime messages per month | ~2M (from memory, not checked) | Far below since the broadcast change | ✅ |
| Realtime Postgres change payload | 1 MB | Largest row ~1 KB | ✅ |
| Image transformations | Paid only | Not used: photos are shrunk in the browser | ✅ |

Pro ($25/month) includes 2M invocations, then about $2 per extra million. Other numbers are on the
Supabase billing and usage pages; the dashboard shows actual usage.

### Why the watched items stay inside

- **Edge Function invocations.** Only calls that fetch something count. pg_cron runs a check
  inside the database every 10 seconds (`private.poll_due()`), which isn't an invocation, and calls
  `poll-games` only when there's work:
  - live games: every 10 s, ~360 calls per hour of live baseball per project;
  - the schedule: every minute around game time, every 10 minutes otherwise;
  - finished games: every 10 minutes for 6 hours (official scoring changes).

  Polling live games every 5 s would roughly double that, close to or over the quota. That's why
  it's 10 s. If more headroom is needed, staging could poll live games less often.
  `player-stats` (the player popup) caches its results in memory, and `draft` runs only on draft
  actions; both are small next to the poller. `almanac` runs when the Almanac tab is first opened
  in an open app (the tab stays open after that), and when a manager's page opens more than 5
  minutes after the last call (the app caches it): a few thousand calls a month at most.
- **The Almanac.** The `almanac` function reads every season's rows next to the database and sends
  back only the computed Almanac, an estimated ~100 KB (not yet measured), where the app used to
  download the raw rows itself (~0.5–1 MB, dominated by box scores and the player pool). At ~15
  apps opening it a couple of times a day, that's roughly 50–100 MB a month instead of ~0.5 GB.
  Whether the function's own reads count as egress isn't documented clearly; at worst they're the
  same bytes the app used to download.
- **Egress.** The Games and Standings tabs load the season once. After that, each poll sends one
  small broadcast on the private `scores` channel with only the changed rows
  (`flush_score_changes`), and the app applies it (`applyChanges` in
  `_shared/core/score-feed.ts`). Full reloads happen only on reconnect, when a game starts, or when
  the server asks. Before this, every change refetched the whole season (50–150 KB), which could
  have reached 10–25 GB in a postseason.
  If the season load fails (or finds no seasons while signed in, as when the app opens before its
  sign-in is renewed), `lib/season.ts` retries up to 6 times over about a minute, then stops. A good
  start costs nothing extra; a bad one at most 6 more loads (~1 MB), and a lasting server error
  can't turn into endless reloads.
  The scores load once per app open for every screen (`ScoresProvider` in `lib/scores.ts`), not
  each time Games or Standings mounts, so bag celebrations can use them anywhere. That's the same
  single load for anyone who opens either tab (most visits) and saves the second load when both
  are mounted. The `scores` broadcast is now heard on every screen, not just those two: one
  message per open app per poll either way, far below the realtime limits.
  Bag celebrations add almost nothing: bags are found in the broadcast the app already gets, and
  the popup's stats come from the loaded scores. Each of your hitters' bags reads this device's
  spoiler delay (one tiny `push_subscriptions` row, only with alerts on), no Edge Function call.
  Tapping a bag alert opens the app as it always did, with the bag in the link.
  The season also reloads once when the app's realtime connection comes back after dropping, as it
  does whenever a phone locks or leaves the app for a while; otherwise picks and roster changes
  made meanwhile would never show. A season load is estimated at ~100 KB (not yet measured; the
  player pool is most of it). At ~15 people coming back to the app ~20 times a day, that's up to
  ~0.9 GB a month, less with compression. Scores already reload on reconnect the same way.
  The Standings scrubber (the chart and slider under the table) fetches nothing: it replays the
  games, box scores and hits the scores load already has. Past seasons now have their hits too
  (2020–2024 backfilled by a migration, ~3,300 rows, about 1 MB of database), so opening a past
  season loads its rostered players' hits as well: ~500 rows, an estimated 50 KB. Even at 20
  past-season views a day that's ~30 MB a month.
  Rebuilding the middle of a day exactly (tiebreakers included) takes the season's play-by-play
  batting lines (`mlb_play_lines`, ~3,500–4,300 rows a season, all hitters). The app loads them for
  the rostered players only, in one request, and only once the scrubber is in the middle of a day
  or playing: an estimated 200–300 KB, kept for the session. Not loading them with the scores
  (every app open) is the point: that would be over 1 GB a month. At ~10 scrubbing sessions a day
  it's ~90 MB a month. During live games the live games' lines reload once a minute while wanted.
  poll-games saves these lines from the play-by-play it already reads for the hits, plus one more
  read of each game 10 minutes after it ends: ~15 extra MLB requests a postseason day, no extra
  Edge Function calls. The table is ~22,000 rows for 2020–2025 (~3 MB).
- **Post PA and Post TB.** The draft table (draft room and Research) loads each hitter's postseason
  PA and TB once when it opens, summed in the database (`postseason_totals`): one small row per
  hitter who has batted, ~15 KB at most by the World Series. Research stays open once opened (see
  Tabs), so that's once per app open rather than per visit. At ~15 people opening it ~10 times a
  day, that's ~70 MB a month at most. It doesn't follow live games, so it adds nothing per poll; the
  poller's box score rows just carry one more number (PA).
- **Tabs.** Like a phone app's, each tab stays mounted once it's opened (`TabScreen` in
  `app/src/components/section-nav.tsx`), so going back to one loads nothing, where every switch
  used to open it anew and reload what it loads for itself (Research's Post PA and TB, the
  Almanac after 5 minutes). A tab that isn't on show starts no loads of its own; the season and
  scores it shows are the app-wide ones. Fewer loads than before, and no new realtime channels or Edge Function calls.
- **Adv% and xBags.** Computed in the app from the season and scores it already loads. The season
  load gains each team's seed and league (a few bytes per team). No new calls, polling or storage.
- **Platoons and batting order.** Kept out of the season load, which reloads often (see Egress):
  the draft table, Research and the player popup load the pool's `platoon` column, the teams'
  rotations and the announced starters once per app open, in one set of requests: an estimated
  50–60 KB uncompressed for ~170 hitters (a JSON record of ~300 bytes each), well under that
  gzipped. At ~15 people opening the app ~10 times a day, that's under 250 MB a month, likely
  ~60 MB compressed. Announced starters are their own table (`mlb_probables`), not `mlb_games`
  columns, so they add nothing to the scores broadcast, which sends whole `mlb_games` rows many
  times a live game. `sync-pool` reads ~12 more MLB responses of ~1 MB each (one team's season
  of lineups), 12 roster splits and one `/people` batch; downloads into the function, not egress,
  and only when the commissioner syncs. `poll-games`'s schedule read adds `hydrate=probablePitcher,
  person` (a few KB more from MLB) and writes `mlb_probables` only when a starter changes. No new
  Edge Function calls, polling or realtime channels. Re-syncing the pool updates ~170 pool rows,
  whose Postgres Changes now carry the platoon record too (~0.3 KB more each), a few times a season.
- **Injured hitters in the pool.** `sync-pool` also reads each playoff team's 40-man roster (12
  more MLB responses) and one `/transactions` list per injured hitter (~25), plus the postseason
  schedule: downloads into the function, only when the commissioner syncs. The pool gains ~25
  rows (~195 instead of ~170) and three small columns, so the season load (mostly the pool) grows
  by an estimated ~15 KB: up to ~0.15 GB more a month at the reload rate under Egress, less with
  compression. The platoon load and a re-sync's Postgres Changes grow by the same ~15%. No new Edge
  Function calls, polling or realtime channels.
- **The player popup's Baggery section.** Each time the popup opens it loads the player's MLB
  team's postseason games (up to ~20 rows) and his TB in them, straight from the tables: ~5 KB. At
  ~15 people opening ~20 popups a day, that's ~45 MB a month. It doesn't follow live games (no
  realtime, no Edge Function call).
- **The player popup's Postseason table.** `player-stats` makes one more request to MLB for the
  player's postseasons and sends back a row per postseason he played in, under ~1 KB more per
  popup. At ~15 people opening ~20 popups a day, that's under 10 MB a month. It's the same
  function call as before, so no new invocations.
- **Hit videos.** No new Edge Function calls on live days: `poll-games` reads a game's play-by-play
  (0.6–1.2 MB from MLB) only when its box score has hits not yet matched to a play, at most every
  20 s, and its highlights (~1 MB) every 2 minutes while live and every 10 minutes for 6 hours
  after, until every hit has a clip. Those are downloads into the function, not egress. The app
  downloads a hitter's hits (well under 1 KB) only when someone taps ▶, and the videos stream
  from MLB and Savant, not us. The Standings scrubber also shows a bag's video links when playback
  stops on it: one hit's `clip_slug` and `savant_ready` (a few hundred bytes), never while playing.
  At ~10 scrubbing sessions a day stopping on ~30 bags each, that's under 10 MB a month.
  The commissioner's Reload button costs about 10 calls per season.
  Savant's videos come the day after a game, so from 12 hours after first pitch the poller loads
  one Savant page (~85–100 KB) per game each hour until it has the video, at most 48 times: ~15–25
  loads per game, a few hundred a day at most in the postseason, inside polls that already run.
- **Bags hit by hit.** The scores load also brings rostered players' hits (play ID, game, player,
  type, time: ~120 bytes each), a few hundred rows by the World Series, so ~20–40 KB more per full
  load late in the postseason. Each new hit rides in the poll's one broadcast; a clip turning up
  doesn't send anything.
- **Sub and cut alerts.** No new MLB requests: a hitter coming off the bench (👀) or being
  replaced (😠) is read from the box score `poll-games` already fetches every 10 s. Each read runs
  one small query that finds the drafted hitters' new changes (usually none, so a few bytes back).
  Cut alerts (🥵 / 😮‍💨) rank the round once per finished game, when its final box score is read
  again ~10 minutes after it ends: ~45 rankings a postseason, each reading the round's batting
  lines (well under 100 KB) inside Supabase. The pushes go straight from the function to the
  browsers' push services, ~1 KB each: a few dozen a day across the league. Alerts waiting out a
  spoiler delay keep the cron job calling `poll-games` for up to 2 more minutes, as bag alerts do.
  That's at most ~12 extra calls per finished game, ~500 a postseason per project. No new
  realtime traffic or app downloads; Settings reads two more booleans from its own row.
- **League log.** One row (~300 bytes) per commissioner action, claim, team rename or name or
  photo change: a few hundred a season.
  Settings reads the latest 20 only for the commissioner, ~6 KB per visit, plus 20 more on
  "Show older". No new function calls, realtime traffic or polling.
- **Lineup alerts.** No new MLB requests or Edge Function calls: the schedule `poll-games`
  already reads (every minute around game time, every 10 minutes otherwise) now also asks for the
  posted lineups (`hydrate=lineups`). That makes each read bigger, up to ~100–150 KB more by the
  World Series (18 hitters a game, every postseason game), but it's a download into the function
  from MLB, not Supabase egress. Each read compares the lineups of games starting within a day with
  `private.lineups` (a couple of dozen small rows) and only looks up drafted hitters and devices
  when one changed: a few times a game. Off by default; the pushes are ~1 KB each.
- **Draft alerts.** No new Edge Function calls, polling or realtime traffic: the draft function,
  already called for each pick, pass or start, sends "⏰ You're on the clock" to the next manager's
  devices after it answers (one small `push_subscriptions` lookup and ~1 KB per device). Four
  drafts of ~30 picks a season: ~150 pushes. Settings reads one more boolean from its own row.
- **Realtime messages per second.** The old per-row Postgres Changes could burst 150–250 messages
  right after a poll on a busy day. One broadcast per poll keeps it to about one message per open
  app every 10 seconds. The draft room still uses Postgres Changes on low-traffic tables
  (`drafts`, `draft_actions`, …).
- **Photos.** Uploaded photos are cropped and shrunk to 256 px in the browser (up to 20 MB picked,
  5 MB bucket limit) and cached for a year (`cacheControl: '31536000'`, new file name per upload).
  They count against cached egress, not egress. Google photos load from Google and cost nothing.
  The future iOS app must shrink photos before upload too.

## Vercel (Hobby)

Vercel only serves the app's static files. Photos, data and realtime all come from Supabase or
Google, so app features don't add Vercel bandwidth. Bandwidth and build minutes on Hobby are far
above what a dozen users need; check the Vercel usage page if the site grows.

## MLB Stats API

Unofficial, with no published rate limit. Its responses are cached for a few seconds, so polling
faster than ~5 s mostly returns the same data and risks getting blocked mid-game. Keep reads
limited to what changed (live games' box scores, not the whole schedule every poll).

## Checklist for changes

Before merging a change that touches any of these, estimate its cost for a busy postseason month
(~25 game days, several live games at once, ~15 open apps) and update this page:

- **New polling, cron jobs or shorter intervals:** Edge Function invocations × 2 projects, and
  MLB API load.
- **New realtime listeners or broadcasts:** messages per second in a burst right after a poll,
  and connections per open app. Prefer one broadcast per poll over per-row Postgres Changes on
  tables that change during games.
- **Refetches or new queries on a live screen:** bytes per refetch × how often × open apps. Never
  refetch the whole season on each live change.
- **Files and images:** size after shrinking, cache headers, and whether they're served from the
  CDN (cached egress) or storage.
- **Paid-only features** (image transformations, larger compute, etc.): don't use them.
