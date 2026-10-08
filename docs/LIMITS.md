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
| Database size | 500 MB | ~45 MB per project in October 2026 (seven seasons, play-by-play lines, and up to 14 MB of pg_cron run history before it was purged daily) | ✅ |
| File storage | 1 GB | Profile photos, ~15 KB each (256 px JPEG): under 1 MB for the league | ✅ |
| Egress | 5 GB / month | Low after the scores broadcast (see below). This is the one to watch | ⚠️ |
| Cached egress (CDN) | 5 GB / month | Photos only, ~5 MB / month | ✅ |
| Edge Function invocations | 500k / month | ~15k per project for a whole postseason (measured: ~345 calls per live hour per project at the old 10 s cadence, one poll a call) | ✅ |
| Log ingestion | 1 GB / month (Supabase says enforcement isn't live yet) | Measured 13.9 MB on October 6 (two games) for both projects, ~0.42 GB in a month of games; about half is Supabase's own pooler health checks. Was ~65 MB a day before October 5 | ✅ |
| Realtime concurrent connections | 200 | One per open app | ✅ |
| Realtime messages per second | 100 | One broadcast per poll, per open app | ✅ |
| Realtime messages per month | ~2M (from memory, not checked) | Far below since the broadcast change | ✅ |
| Realtime Postgres change payload | 1 MB | Largest row ~1 KB | ✅ |
| Image transformations | Paid only | Not used: photos are shrunk in the browser | ✅ |

Pro ($25/month) includes 2M invocations, then about $2 per extra million. Other numbers are on the
Supabase billing and usage pages; the dashboard shows actual usage.

### Why the watched items stay inside

- **Edge Function invocations.** Only calls that fetch something count. The pg_cron job runs a
  check inside the database (`private.poll_due()`), which isn't an invocation, and calls
  `poll-games` only when there's work:
  - live games: every 15 s on production, 8 polls per call, so ~30 calls per hour of live
    baseball (~240 with more than two games live at once), the same on staging;
    Overlapping games share each poll;
  - the schedule: every minute around game time, every 10 minutes otherwise;
  - finished games: every 10 minutes for 6 hours (official scoring changes).

  The cron job runs once a minute, and every 2 minutes while a game is live or starts within 10
  minutes, or alerts are waiting: each of those calls polls every `private.poller.live_every`
  seconds itself (8 polls at the default 15 s, ~110 s a call, inside the 150 s wall clock limit),
  so there's one call per 8 polls: same freshness, an eighth of the calls and their logs (see
  Logs). A call answers the cron job at once and polls in the background (`EdgeRuntime.waitUntil`),
  which changes no counts: waiting for the answer kept a database transaction open that made
  Realtime drop the scores broadcasts sent while it started up. A call's polls share one
  warmed-up function: 4 polls used 234 ms of CPU at the median and 422 ms at most with two live
  games (October 5), so 8 fit well in a call's 2 s. With more than two games live at once, the
  job instead runs every 15 s with one poll a call. Staging polls like production
  (`live_every = 15`, the default). `live_every` can differ per project, but a call writes the
  same logs however many polls it holds, so a slower staging saves next to nothing.
  `player-stats` (the player popup) caches its results in memory, and `draft` runs only on draft
  actions; both are small next to the poller. `almanac` runs when the Almanac tab is first opened
  in an open app (the tab stays open after that), and when a manager's page opens more than 5
  minutes after the last call (the app caches it): a few thousand calls a month at most.
- **Logs.** Supabase meters every log line its services write (1 GB a month on Free, shared by
  both projects), and nearly all of ours are written per poll by Supabase itself, not by our code:
  the function gateway's request line, the runtime's "booted" and "shutdown", the connection
  pooler's connections (~4.4 KB a call in all), plus the API gateway's line per app request
  (~2.7 KB each; ~5,600 a day on production in early October). pg_cron's "cron job starting" lines
  (~1 KB per run, every run, work or not) are off: `cron.log_statement=false`, set per project with
  `supabase --experimental postgres-config update` (it restarts the database). That's why idle
  hours run once a minute and why live polling isn't faster: at 10 s everywhere, with cron logging
  on, both projects together were on course for ~2 GB a month. pg_cron's run history
  (`cron.job_run_details`) is purged daily to two days.
- **The Almanac.** The `almanac` function reads every season's rows next to the database and sends
  back only the computed Almanac: ~133 KB measured locally with all seven seasons (2020–2026),
  about 30 KB of it the Draft 1 picks behind busts and steals. For busts and steals it also reads
  each season's top 120 pool hitters by TB plus Draft 1's picks, with only the platoon splits xBags
  uses: ~250 KB per call, which stays in the function (whether it counts as egress is the same
  open question as below; a few thousand calls a month would be under 1 GB at worst). The app used to download the raw
  rows itself (~0.5–1 MB, dominated by box scores and the player pool). At ~15 apps opening it a
  couple of times a day, that's roughly 50–110 MB a month instead of ~0.5 GB. It counts the
  season being played as far as it's final, but on the same calls: it doesn't refresh on its own.
  Whether the function's own reads count as egress isn't documented clearly; at worst they're the
  same bytes the app used to download.
- **Egress.** The Games and Standings tabs load the season once. After that, each poll sends one
  small broadcast on the private `scores` channel with only the changed rows
  (`flush_score_changes`), and the app applies it (`applyChanges` in
  `_shared/core/score-feed.ts`). Full reloads happen only on reconnect, when a game starts, when
  the server asks, or when a broadcast was missed. Before this, every change refetched the whole
  season (50–150 KB), which could have reached 10–25 GB in a postseason.
  Broadcasts are numbered (`seq`, a few bytes each), and the app reloads when one skips a number
  (one was lost, as happens while Realtime starts up), when one heard during a load is newer than
  the load, or when the numbers start over (a database reset or restore). The second case needs a
  broadcast to land inside a load (under a second, against one every 15 s while games are live):
  up to ~7% of the reloads made during games. Even if all ~200 reconnect reloads a day were, that's
  ~14 more loads a day, under 65 MB a month. Lost broadcasts are rare as long as poll-games answers
  the cron job at once (Edge Function invocations, above): before that, Realtime starting up during
  a ~110 s call lost the scores sent while it waited.
  If the season load fails (or finds no seasons while signed in, as when the app opens before its
  sign-in is renewed), `lib/season.ts` retries up to 6 times over about a minute, then stops. A good
  start costs nothing extra; a bad one at most 6 more loads (~1 MB), and a lasting server error
  can't turn into endless reloads. A failed scores load does the same (`lib/scores.ts`), keeping the
  scores already shown: at most 6 more loads.
  Both big loads are one request each: the season (`season_load`, nine tables) and the scores
  (`scores_load`: games, the rostered players' TB and hits, live games' lines), Postgres functions
  with the same row level security as the tables. The app reloads both after every reconnect
  (~200 times a day on production in October 2026), and each request costs ~3 KB of Supabase logs
  plus usually a CORS preflight, so one request instead of 13 saves ~8 MB of logs a day.
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
- **The player popup's postseason Game log.** `player-stats` makes one more request to MLB for the
  player's postseason games this season and sends back a row for each (up to ~20 at ~100 bytes):
  ~2 KB more per popup. At ~15 people opening ~20 popups a day, that's ~20 MB a month. Same
  function call as before, so no new invocations.
- **The team popup (Games tab).** Its Hitters and Games tabs read what the Games tab already
  holds: no requests. The Available tab loads the team's undrafted hitters' postseason TB when it
  opens, straight from `player_game_stats`: ≤ ~15 players × ≤ ~20 games, ~10 KB. At ~15 people
  opening it ~5 times a day, that's ~20 MB a month. No Edge Function calls, no realtime.
- **Hit videos.** No new Edge Function calls on live days: `poll-games` reads a game's play-by-play
  (0.6–1.2 MB from MLB) only when its box score has hits not yet matched to a play, at most every
  20 s, and its highlights (~1 MB) every 2 minutes while live and every 10 minutes for 6 hours
  after, until every hit has a clip. Those are downloads into the function, not egress. The app
  downloads a hitter's hits (well under 1 KB) only when someone taps ▶, and the videos stream
  from MLB and Savant, not us. The Standings scrubber also shows a bag's video links when playback
  stops on it, from the hit's `clip_slug` and `savant_ready` in the scores (load and broadcast):
  no request of its own. It used to load them per stop, ~370 requests a game day on production.
  The commissioner's Reload button costs about 10 calls per season.
  Savant's videos come the day after a game, so from 12 hours after first pitch the poller loads
  one Savant page (~85–100 KB) per game each hour until it has the video, at most 48 times: ~15–25
  loads per game, a few hundred a day at most in the postseason, inside polls that already run.
- **Bags hit by hit.** The scores load also brings rostered players' hits (play ID, game, player,
  type, time: ~120 bytes each), a few hundred rows by the World Series, so ~20–40 KB more per full
  load late in the postseason. Each new hit rides in the poll's one broadcast. Each hit also
  carries its `clip_slug` and `savant_ready` (~60 bytes more, ~20 KB more per load by the World
  Series: up to ~0.1 GB a month at the reload rate, less compressed) for the scrubber's video
  links, and `has_video` (~20 bytes more in the load and in each broadcast row), so the Games tab's
  ▶ only shows once there's a video: a clip turning up and a game's Savant videos being marked
  ready now ride a poll's broadcast too. Clips come during or just after live polls that already
  broadcast, and Savant marks one game at a time about hourly, so that's a few hundred extra
  small broadcasts in a postseason month (~40 games × ~15 open apps × a few KB: under 5 MB).
- **Sub and cut alerts.** No new MLB requests: a hitter coming off the bench (👀) or being
  replaced (😠) is read from the box score `poll-games` already fetches each poll. Each read runs
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
- **Stat correction alerts.** No new MLB requests, Edge Function calls or realtime traffic: the
  finished-game box scores `poll-games` already re-reads every 10 minutes for 6 hours are what
  bring scoring changes in. A trigger records a drafted hitter's changed total bases (a handful
  a postseason), and each cron call takes them in one small query (usually nothing back). The
  pushes are ~1 KB each, a few per correction. On by default.
- **MLB eliminations and redraft locks.** No new MLB requests, Edge Function calls or realtime
  traffic: when a `poll-games` call read a game or the schedule, it reads the season's games from
  the database (~45 small rows, a few KB inside Supabase, not egress), marks the losers of
  clinched series eliminated and gives a redraft without a lock time its series' first pitch
  (one tiny drafts query; usually no row changes).
- **Draft alerts.** No new Edge Function calls, polling or realtime traffic: the draft function,
  already called for each pick, pass or start, sends "⏰ You're on the clock" to the next manager's
  devices after it answers (one small `push_subscriptions` lookup and ~1 KB per device). Four
  drafts of ~30 picks a season: ~150 pushes. "Draft started" and "Draft done" go to every league
  member's devices twice per draft (~100 pushes a season), and "Autodraft picked" (off by default)
  one per autopick. Settings reads a few more booleans from its own row.
- **Draft queues.** One `draft` call per queue change (add, remove, reorder, pick a drop), a few
  dozen per manager per draft at most: ~12 managers × 4 drafts × ~30 is ~1.5k calls a season,
  under 1% of the invocation quota. The draft room reads your queue (a few small rows) when it
  opens and after a failed save; it isn't realtime, so picks send nothing extra.
- **Realtime messages per second.** The old per-row Postgres Changes could burst 150–250 messages
  right after a poll on a busy day. One broadcast per poll keeps it to about one message per open
  app every 15 seconds. The draft room still uses Postgres Changes on low-traffic tables
  (`drafts`, `draft_actions`, …).
- **Last play.** Each live game's card shows its last finished at-bat ("Judge flyout to CF · 1
  run"). The box score and line score `poll-games` reads don't have it, so it reads the game's
  play-by-play too, filtered with `fields=` to the event, batter, fielder and runners (~80 KB for
  a whole game, ~4 KB gzipped, instead of ~0.7 MB), and only when the line score has moved on to
  another inning, half or batter. MLB's play-by-play can lag its line score by a few seconds, so
  the poller keeps reading it each poll until it has caught up. That's about one read per plate
  appearance, ~80–100 a game, where every poll would be ~700: a few thousand more MLB requests
  per project in a postseason month. Downloads into the function, not egress, and no new Edge
  Function calls. It also reads the game's stored `live` (one small row) each poll to carry the
  play over. The play rides in `mlb_games.live` (~100 bytes), which already changes and is
  broadcast when the batter changes, so it adds about no broadcasts, just ~100 bytes to live
  games' broadcast rows: under ~50 MB a month at 15 open apps.
- **Starters on game cards.** The Games tab's cards for games still to come show the ballpark and
  each team's announced starter with his ERA and postseason line. One request covers every game not
  yet started: its `mlb_games.venue` with its `mlb_probables` rows (~150 bytes a starter, ~350 a
  game: ~10 KB at the start of the postseason, ~1 KB by the World Series). It's read when the
  Games tab opens and again when that set of games changes (one starts, or MLB schedules more), a
  few times a day. At ~15 people opening the tab ~10 times a day, that's under 50 MB a month.
  The series records beside them come from the scores already loaded. `venue` (~25 bytes, "Truist
  Park · Atlanta") rides in every broadcast `mlb_games` row, like the line score: well under
  ~15 MB a month at 15 open apps. `poll-games` reads the starters' numbers on the schedule read: two
  small MLB requests per starter when one is announced and every 6 hours until his game (at most
  6 starters a read), a few hundred a day at the busiest; the schedule read adds
  `hydrate=venue(location)` (a few KB more). Downloads into the function, not egress. No new Edge
  Function calls, polling or realtime channels.
- **Box scores.** Tapping a game on the Games tab opens its box score, loaded then in four small
  requests: its batting lines with names (~20–26 rows), its line score, its posted lineups and
  announced starters, ~3–5 KB in all. A finished game's is kept for the session. A live game's
  then follows the scores broadcast the app already gets, with no refetching, and reloads only if
  a hitter it has no name for bats (a sub), or on a reconnect. At ~15 people opening ~20 box
  scores a day, that's ~50 MB a month. No new Edge Function calls, MLB requests, polling or
  realtime channels.
  What the poller saves grows a little. Batting lines gain batting order, positions and
  strikeouts (~40 bytes more per broadcast row; a strikeout changes AB too, so no extra rows are
  sent). `mlb_games` gains the line score by inning (~100 bytes), read from the linescore
  `poll-games` already fetches; every broadcast `mlb_games` row carries it, so a live game's
  broadcasts grow by ~100 bytes each: at 15 open apps, ~240 polls an hour and ~45 three-hour
  games, up to ~70 MB a month, less since only changed rows are sent. The scores load doesn't
  select it. Posted lineups go to their own table (`mlb_lineups`, not broadcast), written from
  the schedule read that lineup alerts already use, only when a lineup changes.
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

- **New polling, cron jobs or shorter intervals:** Edge Function invocations × 2 projects, log
  lines (~4.4 KB per poll call), and MLB API load.
- **New realtime listeners or broadcasts:** messages per second in a burst right after a poll,
  and connections per open app. Prefer one broadcast per poll over per-row Postgres Changes on
  tables that change during games.
- **Refetches or new queries on a live screen:** bytes per refetch × how often × open apps. Never
  refetch the whole season on each live change.
- **Files and images:** size after shrinking, cache headers, and whether they're served from the
  CDN (cached egress) or storage.
- **Paid-only features** (image transformations, larger compute, etc.): don't use them.
