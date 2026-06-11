/**
 * Minimal static server for the local sample-review page (and the mp4s it
 * references). Handles HTTP Range requests so video seeking works. Uses
 * node:http so it runs under the project's Node-runtime scripts (no Bun
 * globals).
 *
 * Usage:  bun scripts/serve-review.ts          # http://localhost:8000/
 *         PORT=9000 bun scripts/serve-review.ts
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const port = Number(process.env.PORT ?? 8000);
const ROOT = process.cwd();

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  let pathname = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  if (pathname === '/') pathname = '/sample-review.html';
  if (pathname.includes('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const filePath = path.join(ROOT, pathname);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }

  const size = statSync(filePath).size;
  const type =
    CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
  const rangeHeader = req.headers.range;
  const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;

  if (match) {
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(size),
    'Accept-Ranges': 'bytes',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`▶  http://localhost:${port}/sample-review.html`);
});
