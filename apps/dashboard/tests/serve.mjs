// Static assets only. API behavior is explicitly intercepted by the contract tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../dist/dashboard/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') throw new Error('Only static reads are supported.');
    const pathname = new URL(request.url, 'http://127.0.0.1:4630').pathname;
    const path = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!path.startsWith(root)) throw new Error('Invalid asset path.');
    const body = await readFile(path); response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream'); response.end(body);
  } catch { response.statusCode = 404; response.end('Build the dashboard before running its contract tests.'); }
}).listen(4630, '127.0.0.1');
