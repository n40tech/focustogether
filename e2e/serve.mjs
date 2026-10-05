// Builds the web app for the browser tests and serves it on PORT (see
// playwright.config.ts). The build ignores your .env: it talks to a Supabase
// address where nothing is, and the tests answer its calls themselves (see
// e2e/fake-supabase.ts). Testing tools are off, as on the real site.
//
// Run it in a terminal of its own to keep a server going between test runs:
//   node e2e/serve.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'node_modules', '.cache', 'focus-e2e');
const port = Number(process.env.PORT ?? 8790);

const env = {
  ...process.env,
  EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'browser-tests',
};
delete env.EXPO_PUBLIC_TESTING;

// --clear, because Metro would otherwise reuse code built with your .env's values.
const build = spawnSync(
  'npx',
  ['expo', 'export', '--platform', 'web', '--output-dir', out, '--clear'],
  { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' }
);
if (build.status !== 0) process.exit(build.status ?? 1);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

// Like the real host: /garden is garden.html, and anything else is the not-found page.
http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    for (const candidate of [url, `${url}.html`, path.join(url, 'index.html')]) {
      const file = path.join(out, candidate);
      if (file.startsWith(out) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, {
          'content-type': types[path.extname(file)] ?? 'application/octet-stream',
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    res.writeHead(404, { 'content-type': types['.html'] });
    fs.createReadStream(path.join(out, '+not-found.html')).pipe(res);
  })
  .listen(port, () => console.log(`The test build is on http://localhost:${port}`));
