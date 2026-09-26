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
  actions; both are small next to the poller.
- **Egress.** The Games and Standings tabs load the season once. After that, each poll sends one
  small broadcast on the private `scores` channel with only the changed rows
  (`flush_score_changes`), and the app applies it (`applyChanges` in
  `_shared/core/score-feed.ts`). Full reloads happen only on reconnect, when a game starts, or when
  the server asks. Before this, every change refetched the whole season (50–150 KB), which could
  have reached 10–25 GB in a postseason.
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
