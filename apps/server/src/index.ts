import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import { createApp } from './app.js';
import { createCodexProvider } from '../../../packages/runtime/src/index.js';

const port = Number(process.env.GUIDEKIT_PORT ?? 4410);
const demoPort = Number(process.env.GUIDEKIT_DEMO_PORT ?? 4411);
const secondPort = Number(process.env.GUIDEKIT_SECOND_DEMO_PORT ?? 4412);
const provider = createCodexProvider({ model: process.env.GUIDEKIT_MODEL, bin: process.env.GUIDEKIT_CODEX_BIN, cwd: resolve(process.env.GUIDEKIT_DATA_DIR ?? '.data', 'model-sandbox') });
const core = createApp({ dataDir: resolve(process.env.GUIDEKIT_DATA_DIR ?? '.data'), provider, adminOrigins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:4413', 'http://localhost:4413']) });
const servers: Server[] = [];
async function listen(server: Server, serverPort: number) {
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(serverPort, '127.0.0.1', () => { server.off('error', reject); accept(); }); }); servers.push(server);
}
try {
  await listen(createServer(core.app), port);
  const demoDir = resolve(existsSync('dist/demo/crm.html') ? 'dist/demo' : 'apps/demo');
  for (const [demoKind, serverPort] of [['crm', demoPort], ['support', secondPort]] as const) {
    const demo = express(); demo.disable('x-powered-by');
    demo.use((req, res, next) => { if (!['127.0.0.1', 'localhost'].includes(req.hostname)) { res.sendStatus(403); return; } next(); });
    demo.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", `http://127.0.0.1:${port}`], connectSrc: ["'self'", `http://127.0.0.1:${port}`], styleSrc: ["'self'", "'unsafe-inline'"], upgradeInsecureRequests: null } } }));
    demo.get('/', (_req, res) => res.sendFile(resolve(demoDir, `${demoKind}.html`)));
    demo.use(express.static(demoDir, { index: false, dotfiles: 'deny' }));
    await listen(createServer(demo), serverPort);
  }
  console.log(`GuideKit dashboard: http://127.0.0.1:${port}\nCRM demo: http://127.0.0.1:${demoPort}\nSupport demo: http://127.0.0.1:${secondPort}\nPersonal model runtime stays on loopback. No paid API fallback.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not start GuideKit.');
  for (const server of servers) server.close(); await core.close(); process.exitCode = 1;
}
let closing = false;
const shutdown = async () => {
  if (closing) return; closing = true;
  for (const server of servers) { server.close(); server.closeIdleConnections(); }
  await core.close();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
