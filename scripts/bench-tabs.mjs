// Times switching between the phone tab bar's tabs in the web app, the way a phone would see it:
// an iPhone-sized viewport with the CPU slowed down 4x (a mid-range phone next to a laptop).
//
// For each tap it reports how long until the new tab has settled (no loader, and the page hasn't
// changed for a moment), the longest task that blocked the main thread, how many network requests
// the switch made, and how many DOM nodes the page holds afterwards. That last number growing
// round after round means old screens stay mounted behind the new ones.
//
// Run the app against local Supabase first (see CLAUDE.md), seeded with `scripts/seed-local.ts`:
//   npm i -g playwright && npx playwright install chromium
//   NODE_PATH=$(npm root -g) node scripts/bench-tabs.mjs [url] [rounds]
// Playwright isn't one of the repo's dependencies, so it's loaded from NODE_PATH.
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const URL = process.argv[2] ?? 'http://localhost:8081';
const ROUNDS = Number(process.argv[3] ?? 3);
const TABS = ['Draft', 'Standings', 'Games', 'Research', 'Almanac'];
const CPU_SLOWDOWN = 4;
/** The page counts as settled once nothing on it has changed for this long. */
const QUIET_MS = 150;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

// Long tasks and DOM changes, recorded in the page from the start.
await page.addInitScript(() => {
  window.__bench = { longTasks: [], lastMutation: performance.now() };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__bench.longTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
  const watch = () =>
    new MutationObserver(() => (window.__bench.lastMutation = performance.now())).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  if (document.documentElement) watch();
  else document.addEventListener('DOMContentLoaded', watch);
});

let requests = 0;
page.on('request', (r) => {
  if (!/\.(js|css|png|jpg|webp|svg|ttf|woff2?)(\?|$)/.test(r.url())) requests++;
});

await page.goto(URL);
const signIn = page.getByText('Sign in as test user');
if (await signIn.isVisible({ timeout: 10_000 }).catch(() => false)) await signIn.click();
await page.getByRole('tab', { name: 'Draft' }).waitFor({ timeout: 30_000 });
await settle();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });

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

const results = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const tab of TABS) {
    requests = 0;
    const start = await page.evaluate(() => performance.now());
    await page.getByRole('tab', { name: tab }).click();
    const settled = await settle(start);
    const { longest, nodes } = await page.evaluate((from) => {
      const tasks = window.__bench.longTasks.filter((t) => t.start >= from);
      return { longest: Math.max(0, ...tasks.map((t) => t.duration)), nodes: document.getElementsByTagName('*').length };
    }, start);
    results.push({ round, tab, ms: Math.round(settled - start), longestTaskMs: Math.round(longest), requests, domNodes: nodes });
  }
}

console.table(results);
const byTab = TABS.map((tab) => {
  const ms = results.filter((r) => r.tab === tab).map((r) => r.ms).sort((a, b) => a - b);
  return { tab, medianMs: ms[Math.floor(ms.length / 2)], worstMs: ms.at(-1) };
});
console.table(byTab);
await browser.close();
