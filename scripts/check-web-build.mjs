// Fails when the web build grows past its budget: every phone downloads and parses all of it
// before the app opens. (In #243 the tab bar's icons waited on a 1 MB font that came in this way.)
//
//   cd app && npx expo export --platform web && cd .. && node scripts/check-web-build.mjs app/dist
//
// When it fails: find what grew (a new dependency, an asset, a font), and drop or shrink it. If
// the growth is worth it, raise the budget here in the same PR and say why in it.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The app's JavaScript, in bytes: 3.15 MB on 2026-10-04, plus about 10%. */
const JS_BUDGET = 3_450_000;
/** Everything else (CSS, images, fonts, the page): 0.34 MB on 2026-10-04. */
const OTHER_BUDGET = 500_000;

const dist = process.argv[2] ?? 'app/dist';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : [{ path: relative(dist, path), size: statSync(path).size }];
  });
}

const all = files(dist);
const js = all.filter((f) => f.path.endsWith('.js'));
const other = all.filter((f) => !f.path.endsWith('.js'));
const total = (list) => list.reduce((sum, f) => sum + f.size, 0);
const mb = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;
const biggest = (list) =>
  list
    .toSorted((a, b) => b.size - a.size)
    .slice(0, 5)
    .map((f) => `    ${mb(f.size)}  ${f.path}`)
    .join('\n');

let failed = false;
for (const [label, list, budget] of [
  ['JavaScript', js, JS_BUDGET],
  ['Other files', other, OTHER_BUDGET],
]) {
  const size = total(list);
  const over = size > budget;
  failed ||= over;
  console.log(`${label}: ${mb(size)} of ${mb(budget)}${over ? '  OVER BUDGET' : ''}`);
  if (over) console.log(`  Biggest:\n${biggest(list)}`);
}
if (failed) {
  console.error('The web build is over budget. See scripts/check-web-build.mjs.');
  process.exit(1);
}
