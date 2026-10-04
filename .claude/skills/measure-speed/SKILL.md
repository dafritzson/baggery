---
name: measure-speed
description: Measure how fast the web app switches tabs and opens, on the Mac (production build, Playwright) and on Daniel's iPhone over USB, and what CI checks guard it. Use when the app feels slow or laggy, before and after a change meant to speed it up, after big changes to a tab, or when CI's "React Compiler skips nothing new" or "Web build within budget" step fails.
---

# Measuring the app's speed

Lag shows up on iPhone Safari first; desktop browsers hide most of it. There are three layers:

1. **CI, on every PR (cheap, no browser):** two checks that fail on the regressions we've had.
2. **Mac benchmark (`scripts/bench-tabs.mjs`), by hand:** a production build against local
   Supabase, timed in Playwright. It catches big changes and counts React renders and DOM nodes.
3. **iPhone (`scripts/bench-iphone.py`), by hand:** the real thing. Use it to judge any change
   meant to make the app feel faster.

## CI checks

- **React Compiler skips nothing new** (`scripts/check-react-compiler.mjs`). The compiler silently
  skips a component or hook on syntax it can't handle, and a skipped one isn't memoized. A skipped
  `useLiveSeason` once re-rendered every screen on every navigation (#148). If it fails, rewrite the
  function as the message suggests. Or, if it's rarely rendered, add it to `KNOWN_SKIPS` with why.
- **Web build within budget** (`scripts/check-web-build.mjs`). This is the JS and other-file size
  of `expo export`. A 1 MB icon font once left the tab bar blank on open (#243). If it fails, find
  what grew. If the growth is worth it, raise the budget in the same PR and say why.

Both run locally too: `node scripts/check-react-compiler.mjs`, and after an export,
`node scripts/check-web-build.mjs app/dist`.

## Mac benchmark

Needs local Supabase running and seeded (CLAUDE.md, Commands). Use the 2025 season: it's
finished, so it has the most to draw.

```bash
# Playwright isn't a repo dependency: install it in the scratchpad. 1.63.0 matches the browsers
# already in ~/Library/Caches/ms-playwright.
cd <scratchpad> && npm i playwright@1.63.0
# A production build (the dev server is much slower), served as a single-page app.
cd <repo>/app && EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  EXPO_PUBLIC_SUPABASE_KEY=<publishable key from npx supabase status> EXPO_PUBLIC_APP_ENV=local \
  npx expo export --platform web
cd <repo> && node scripts/serve-spa.mjs app/dist 8090   # keep running (run_in_background)
NODE_PATH=<scratchpad>/node_modules node scripts/bench-tabs.mjs http://localhost:8090 3 2025 chromium
```

Chromium runs with the CPU slowed 4x. Use `webkit` (Safari's engine, unthrottled) as a second
opinion. Timings vary ±20% between runs, so compare medians of a few runs, before and after, on
the same machine. Renders and DOM nodes don't vary between runs, so trust those.

Baseline on 2026-10-04 (Chromium 4x, second visits):

| tab | first frame (ms) | back again (ms) | renders back |
|---|---|---|---|
| Draft | 96 | 44 | 1,186 |
| Standings | 94 | 22 | 190 |
| Games | 99 | 27 | 187 |
| Research | 409 | 26 | 187 |
| Almanac | 65 | 42 | 1,175 |

With every tab open, the page holds 8,234 DOM nodes.

What to look for:

- **Renders back** jumping into the thousands for every tab means tabs that aren't on show are
  re-rendering, often from a compiler skip or a context value that changes on every navigation.
  Draft and Almanac sit at ~1,180 because each is a stack and its own page re-renders on return.
  That's a known lead, not yet looked into.
- **DOM nodes** growing round after round means old screens stay mounted. Research alone is ~6,000,
  and Safari's cost of showing a tab grows with its nodes.

## iPhone

Daniel plugs his iPhone into the Mac over USB and turns on Settings → Apps → Safari → Advanced →
Web Inspector and Remote Automation. He opens the app (staging, or production) in a **Safari tab**,
not the Home Screen app, signs in, and keeps the phone unlocked with Safari in front. Check that
Low Power Mode is off: it halves the frame rate. The phone flips through the tabs by itself for
about 20 seconds; tell Daniel before running it.

```bash
python3 -m venv <scratchpad>/venv && <scratchpad>/venv/bin/pip install pymobiledevice3
<scratchpad>/venv/bin/python scripts/bench-iphone.py 3
```

Baseline on 2026-10-04 (iPhone 17 Pro, staging, after #243), tap to drawn: about 81–99 ms for
every tab. That's roughly React ~15 ms, then Safari's ~50–65 ms floor for putting a different page
on screen. #243 tried every way of hiding or covering tabs and none got under that floor. Before
#243, Research and Almanac took 115–131 ms, because Safari laid them out again on every return.

For questions the script doesn't answer, run your own JS in the page through the same session
(`session.runtime_evaluate`). Useful probes:

- A MutationObserver timestamp marks React's commit.
- Reading `document.body.offsetHeight` right after it times style and layout.
- A MessageChannel ping loop shows when the main thread is busy.
- Injecting a `<style>` tries a CSS fix live; a reload undoes it.

Safari's Timeline domain records events over this connection, but every timestamp comes back 0.
