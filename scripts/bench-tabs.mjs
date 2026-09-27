// Times switching between the phone tab bar's tabs in the web app, the way a phone would see it:
// an iPhone-sized viewport with the CPU slowed down 4x (a mid-range phone next to a laptop).
//
// Each tap holds for TAP_MS, as a finger does. For each one it reports:
// - frame: from the end of the tap to the first frame drawn with the new tab on screen. This is the
//   lag you feel, and what a native tab bar gets to within a frame or two.
// - settled: until the new tab has finished filling in (no loader, and nothing has changed for a
//   moment; the tab bar's own animation doesn't count).
// - longest task: the longest stretch the main thread was blocked, when taps and scrolling wait.
// - requests the switch made, and DOM nodes the page holds afterwards. Nodes growing round after
//   round means old screens stay mounted behind the new ones.
//
// Run the app against local Supabase first (see CLAUDE.md), seeded with `scripts/seed-local.ts`.
// A production build (`npx expo export -p web`, served as a single-page app) gives numbers closer
// to what phones get than the dev server does.
//   npm i -g playwright && npx playwright install chromium
//   NODE_PATH=$(npm root -g) node scripts/bench-tabs.mjs [url] [rounds] [year] [chromium|webkit]
// Playwright isn't one of the repo's dependencies, so it's loaded from NODE_PATH. The year picks
// a season (a finished one has the most to draw). WebKit can't slow the CPU down or report long
// tasks, but it's the engine iPhones use.
import { createRequire } from 'node:module';

const playwright = createRequire(import.meta.url)('playwright');

const URL = process.argv[2] ?? 'http://localhost:8081';
const ROUNDS = Number(process.argv[3] ?? 3);
const YEAR = process.argv[4] && process.argv[4] !== '-' ? process.argv[4] : undefined;
const ENGINE = process.argv[5] ?? 'chromium';
const TABS = [
  { label: 'Draft', path: '/draft' },
  { label: 'Standings', path: '/standings' },
  { label: 'Games', path: '/games' },
  { label: 'Research', path: '/research' },
  { label: 'Almanac', path: '/almanac' },
];
const CPU_SLOWDOWN = ENGINE === 'chromium' ? 4 : 1;
/** How long a tap holds, from finger down to up: about what a quick tap on a phone takes. */
const TAP_MS = 80;
/** The page counts as settled once nothing on it has changed for this long. */
const QUIET_MS = 150;

const browser = await playwright[ENGINE].launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: ENGINE === 'chromium',
  hasTouch: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));

// Recorded in the page from the start: long tasks, the last change outside the tab bar, and taps.
await page.addInitScript(() => {
  window.__bench = { longTasks: [], lastMutation: performance.now(), tapAt: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__bench.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // WebKit has no long tasks.
  }
  addEventListener('click', (e) => (window.__bench.tapAt = e.timeStamp), true);
  const watch = () =>
    new MutationObserver((records) => {
      if (records.some((r) => !r.target.closest?.('[data-tab-bar]') && !r.target.parentElement?.closest('[data-tab-bar]')))
        window.__bench.lastMutation = performance.now();
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) watch();
  else document.addEventListener('DOMContentLoaded', watch);
});

let requests = 0;
page.on('request', (r) => {
  if (!/\.(js|css|png|jpg|webp|svg|ttf|woff2?)(\?|$)/.test(r.url())) requests++;
});

await page.goto(URL);
const tabBar = page.getByRole('tab', { name: 'Draft' });
const signIn = page.getByText('Sign in as test user');
await Promise.race([tabBar.waitFor({ timeout: 30_000 }), signIn.waitFor({ timeout: 30_000 })]);
if (await signIn.isVisible()) await signIn.click();
await tabBar.waitFor({ timeout: 30_000 });
// Start from Home, on the season picked, so every tab's first visit is in round 1. Its game keeps
// drawing, so this waits a moment rather than for the page to settle.
await page.goto(`${URL}/${YEAR ? `?year=${YEAR}` : ''}`);
await tabBar.waitFor({ timeout: 30_000 });
await page.waitForTimeout(2000);
if (CPU_SLOWDOWN > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
}

/**
 * Waits until the page has changed since `from`, shows no loader and then hasn't changed for
 * QUIET_MS; returns when that quiet began. A tap that changes nothing settles at `from`.
 */
async function settle(from = 0) {
  await page.waitForFunction(
    ({ from, quiet }) => {
      const now = performance.now();
      if (now - from > 2000 && window.__bench.lastMutation <= from) return true;
      return (
        window.__bench.lastMutation > from &&
        !document.querySelector('[aria-label="Loading"]') &&
        now - window.__bench.lastMutation > quiet
      );
    },
    { from, quiet: QUIET_MS },
    { polling: 50, timeout: 30_000 },
  );
  return page.evaluate((from) => Math.max(from, window.__bench.lastMutation), from);
}

/**
 * Starts watching for the first frame that shows `path`: checked at the start of every frame, and
 * timed once that frame's rendering is done. `drawnAt()` waits for it.
 */
async function watchFirstFrame(path) {
  await page.evaluate((path) => {
    window.__bench.frame = new Promise((resolve) => {
      const check = () => {
        if (location.pathname === path) setTimeout(() => resolve(performance.now()), 0);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }, path);
  return () => page.evaluate(() => Promise.race([window.__bench.frame, new Promise((_, reject) => setTimeout(() => reject(new Error('no frame')), 30_000))]));
}

const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const tab of TABS) {
    requests = 0;
    const start = await page.evaluate(() => performance.now());
    const drawnAt = await watchFirstFrame(tab.path);
    await page.getByRole('tab', { name: tab.label }).click({ delay: TAP_MS });
    const drawn = await drawnAt();
    const settled = await settle(start);
    const { tapAt, longest, nodes } = await page.evaluate((from) => {
      const tasks = window.__bench.longTasks.filter((t) => t.start >= from);
      return {
        tapAt: window.__bench.tapAt,
        longest: Math.max(0, ...tasks.map((t) => t.duration)),
        nodes: document.getElementsByTagName('*').length,
      };
    }, start);
    const tap = tapAt > start ? tapAt : start;
    results.push({
      round,
      tab: tab.label,
      frameMs: Math.round(drawn - tap),
      settledMs: Math.round(Math.max(drawn, settled) - tap),
      longestTaskMs: Math.round(longest),
      requests,
      domNodes: nodes,
    });
  }
}

console.table(results);
// Round 1 opens each tab for the first time; later rounds come back to it.
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.table(
  TABS.map(({ label }) => {
    const rows = results.filter((r) => r.tab === label);
    const again = rows.filter((r) => r.round > 1);
    return {
      tab: label,
      firstFrameMs: rows[0].frameMs,
      firstSettledMs: rows[0].settledMs,
      againMedianFrameMs: again.length ? median(again.map((r) => r.frameMs)) : null,
      againWorstFrameMs: again.length ? Math.max(...again.map((r) => r.frameMs)) : null,
    };
  }),
);
await browser.close();
