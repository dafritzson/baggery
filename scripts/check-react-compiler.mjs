// Fails when the React Compiler skips a function in the app that isn't on the list below.
//
// The compiler skips a whole component or hook, with no error or lint warning, when it meets
// syntax it can't handle (`x++` on a variable a callback also reads, `??` inside `||`, `for (;;)`,
// a disabled react-hooks lint rule, ...). A skipped component isn't memoized, and a skipped hook
// that feeds a context (useLiveSeason before #148) re-renders every screen on every navigation.
//
//   node scripts/check-react-compiler.mjs
//
// When it fails: rewrite the function so it compiles (the message says what the compiler didn't
// like), or, if it's rarely rendered and not worth it, add it to KNOWN_SKIPS with why.
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
// The compiler and Babel come with the app's dependencies (babel-preset-expo).
const require = createRequire(join(root, 'app', 'package.json'));
const babel = require('@babel/core');

/** `file: function` skips that are known and fine, each with why. */
const KNOWN_SKIPS = {
  'app/src/app/(tabs)/draft/[id].tsx: AutodraftSwitch': 'one switch in the draft room; its save loop is a for (;;)',
  'app/src/components/google-sign-in-button.web.tsx: GoogleSignInButton': 'the sign-in screen only',
  'app/src/components/team-popup.tsx: usePostseasonTb': 'a popup tab, loaded on open',
  'app/src/components/team-popup.tsx: AvailableTab': 'a popup tab, loaded on open',
};

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path] : [];
  });
}

/** The name of the function declared on `line`: `function Name(`, `const Name =`, `export default function Name`. */
function functionName(lines, line) {
  const m = lines[line - 1]?.match(/function\s+(\w+)|(?:const|let)\s+(\w+)\s*=/);
  return m ? (m[1] ?? m[2]) : `line ${line}`;
}

const skips = new Map();
for (const path of sourceFiles(join(root, 'app', 'src'))) {
  const file = relative(root, path);
  const source = readFileSync(path, 'utf8');
  const lines = source.split('\n');
  babel.transformSync(source, {
    filename: path,
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }]],
    plugins: [
      [
        require.resolve('babel-plugin-react-compiler'),
        {
          panicThreshold: 'none',
          logger: {
            logEvent(_, event) {
              if (event.kind !== 'CompileError' && event.kind !== 'PipelineError') return;
              const line = event.fnLoc?.start.line;
              const key = `${file}: ${line ? functionName(lines, line) : '?'}`;
              const reason = event.detail?.reason ?? event.detail?.options?.reason ?? event.data ?? '';
              if (!skips.has(key)) skips.set(key, `${String(reason).split('\n')[0]} (line ${line})`);
            },
          },
        },
      ],
    ],
  });
}

const unexpected = [...skips].filter(([key]) => !(key in KNOWN_SKIPS));
const fixed = Object.keys(KNOWN_SKIPS).filter((key) => !skips.has(key));
for (const key of fixed) console.log(`Compiles now, take it off KNOWN_SKIPS: ${key}`);
if (unexpected.length) {
  console.error('The React Compiler skips these, so they are not memoized:');
  for (const [key, reason] of unexpected) console.error(`  ${key}: ${reason}`);
  console.error('Rewrite them so they compile, or add them to KNOWN_SKIPS in scripts/check-react-compiler.mjs.');
  process.exit(1);
}
console.log(`React Compiler: no unexpected skips (${skips.size} known).`);
