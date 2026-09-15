/**
 * 零依赖静态服务器：用来本地预览 dist/（或任何目录）。
 * 用法：node scripts/serve.mjs [目录] [端口]
 *
 * 只依赖 node:http / node:fs —— 不 spawn 任何子进程，所以在受限环境里也能跑。
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));
const port = Number(process.argv[3] ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = path.join(root, rel);
    if (!full.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const info = await stat(full).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${rel}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(full).pipe(res);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[serve] ${root} → http://127.0.0.1:${port}/`);
});
