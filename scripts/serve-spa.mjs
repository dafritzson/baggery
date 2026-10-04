// Serves a web build as a single-page app (any path that isn't a file gets index.html), for
// benchmarking a production build locally. See .claude/skills/measure-speed/SKILL.md.
//   node scripts/serve-spa.mjs [dir] [port]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const dir = process.argv[2] ?? 'app/dist';
const port = Number(process.argv[3] ?? 8090);
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

createServer((req, res) => {
  let path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(dir) || !existsSync(path) || statSync(path).isDirectory()) path = join(dir, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}`));
