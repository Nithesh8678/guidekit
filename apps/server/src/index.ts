import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import { createApp, type InferenceProvider } from './app.js';
import { createCodexProvider } from '../../../packages/runtime/src/index.js';
import { createOpenAIProvider } from '../../../packages/runtime/src/openai.js';
import { createTigerGraphProvider } from '../../../packages/graph/src/index.js';
import { acquireProcessLock } from './process-lock.js';
import { AsyncRepository } from './repository.js';
import { asKnowledgeProvider } from './knowledge.js';
import { createPostgresKnowledgeProvider, createLocalEmbeddingProvider, type EmbeddingProvider } from '../../../packages/knowledge/src/index.js';
import type { KnowledgeProvider } from '../../../packages/knowledge/src/types.js';

function capacity(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error('Invalid capacity configuration.');
  return value;
}

async function start(): Promise<void> {
  const servers: Server[] = [];
  let repository: AsyncRepository | undefined, provider: InferenceProvider | undefined, knowledge: KnowledgeProvider | undefined, embeddings: EmbeddingProvider | undefined;
  let core: Awaited<ReturnType<typeof createApp>> | undefined, releaseLock: (() => void) | undefined;
  let phase = 'configuration';
  try {
    const port = Number(process.env.GUIDEKIT_PORT ?? 4410), demoPort = Number(process.env.GUIDEKIT_DEMO_PORT ?? 4411), secondPort = Number(process.env.GUIDEKIT_SECOND_DEMO_PORT ?? 4412);
    if ([port, demoPort, secondPort].some(value => !Number.isInteger(value) || value < 1 || value > 65535) || new Set([port, demoPort, secondPort]).size !== 3) throw new Error('Invalid loopback ports.');
    const selectedProvider = process.env.GUIDEKIT_PROVIDER ?? 'codex', selectedKnowledge = process.env.GUIDEKIT_KNOWLEDGE_PROVIDER ?? 'local';
    if (!['codex', 'openai'].includes(selectedProvider) || !['local', 'postgres', 'tigergraph'].includes(selectedKnowledge)) throw new Error('Invalid provider selection.');
    const limits = { dailyRuns: capacity('GUIDEKIT_DAILY_RUN_LIMIT', 500), activeSessions: capacity('GUIDEKIT_ACTIVE_SESSION_LIMIT', 100) };
    const legacyGraphEnabled = process.env.GUIDEKIT_LEGACY_TIGERGRAPH_ENABLED === 'true';
    const needsGraph = selectedKnowledge === 'tigergraph' || selectedKnowledge === 'postgres' && legacyGraphEnabled;
    if (needsGraph && (!process.env.TIGERGRAPH_BASE_URL || (!process.env.TIGERGRAPH_TOKEN && !process.env.TIGERGRAPH_SECRET))) throw new Error('TigerGraph compatibility configuration is incomplete.');
    if (selectedKnowledge === 'postgres' && !process.env.GUIDEKIT_KNOWLEDGE_DATABASE_URL) throw new Error('The restricted PostgreSQL knowledge URL is required.');
    const dataDir = resolve(process.env.GUIDEKIT_DATA_DIR ?? '.data');
    phase = 'workspace locking'; releaseLock = acquireProcessLock(dataDir); process.once('exit', releaseLock);
    const graph = needsGraph ? createTigerGraphProvider({ baseUrl: process.env.TIGERGRAPH_BASE_URL!, graphName: process.env.TIGERGRAPH_GRAPH_NAME ?? 'GuideKit', token: process.env.TIGERGRAPH_TOKEN, secret: process.env.TIGERGRAPH_SECRET, restppPrefix: process.env.TIGERGRAPH_RESTPP_PREFIX ?? '/restpp' }) : undefined;
    // Runtime only loads the pinned, previously prepared local cache. An incoming
    // visitor request never starts a weight download or calls an embedding API.
    if (selectedKnowledge === 'postgres') {
      phase = 'local embedding preparation';
      embeddings = createLocalEmbeddingProvider({ cacheDir: process.env.GUIDEKIT_EMBEDDING_CACHE_DIR ?? resolve(dataDir, 'models'), localFilesOnly: true });
      await embeddings.embed(['GuideKit local embedding readiness check']);
      knowledge = createPostgresKnowledgeProvider({ connectionString: process.env.GUIDEKIT_KNOWLEDGE_DATABASE_URL!, embeddings });
    } else knowledge = asKnowledgeProvider(graph);
    // A configured PostgreSQL URL is strict; migrations belong to an explicit
    // operator command, never to the restricted runtime role or a fallback.
    phase = 'database verification'; repository = await AsyncRepository.open({ dir: dataDir, connectionString: process.env.GUIDEKIT_DATABASE_URL });
    if (selectedKnowledge === 'postgres') { phase = 'knowledge verification'; if (!(await knowledge!.status()).connected) throw new Error('Knowledge verification failed.'); }
    provider = selectedProvider === 'openai'
      ? createOpenAIProvider({ enabled: process.env.GUIDEKIT_OPENAI_ENABLED === 'true', apiKey: process.env.OPENAI_API_KEY, model: process.env.GUIDEKIT_OPENAI_MODEL })
      : createCodexProvider({ model: process.env.GUIDEKIT_MODEL, bin: process.env.GUIDEKIT_CODEX_BIN, cwd: resolve(dataDir, 'model-sandbox') });
    phase = 'application initialization';
    core = await createApp({ dataDir, repository, provider, knowledge, graph, limits, endpointOrigin: `http://127.0.0.1:${port}`, demoOrigins: { crm: `http://127.0.0.1:${demoPort}`, support: `http://127.0.0.1:${secondPort}` }, adminOrigins: new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:4413', 'http://localhost:4413']) });
    async function listen(server: Server, serverPort: number) {
      await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(serverPort, '127.0.0.1', () => { server.off('error', reject); accept(); }); }); servers.push(server);
    }
    phase = 'loopback listening'; await listen(createServer(core.app), port);
    const demoDir = resolve(existsSync('dist/demo/crm.html') ? 'dist/demo' : 'apps/demo');
    for (const [demoKind, serverPort] of [['crm', demoPort], ['support', secondPort]] as const) {
      const demo = express(); demo.disable('x-powered-by');
      demo.use((req, res, next) => { if (!['127.0.0.1', 'localhost'].includes(req.hostname)) { res.sendStatus(403); return; } next(); });
      demo.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", `http://127.0.0.1:${port}`], connectSrc: ["'self'", `http://127.0.0.1:${port}`], styleSrc: ["'self'", "'unsafe-inline'"], upgradeInsecureRequests: null } } }));
      demo.get('/guidekit-config.js', (_req, res) => res.type('application/javascript').send(`window.__GUIDEKIT_ENDPOINT__=${JSON.stringify(`http://127.0.0.1:${port}`)};`));
      demo.get('/', (_req, res) => res.sendFile(resolve(demoDir, `${demoKind}.html`)));
      demo.use(express.static(demoDir, { index: false, dotfiles: 'deny' })); await listen(createServer(demo), serverPort);
    }
    console.log(`GuideKit dashboard: http://127.0.0.1:${port}\nCRM demo: http://127.0.0.1:${demoPort}\nSupport demo: http://127.0.0.1:${secondPort}\nSelected provider: ${selectedProvider}. Knowledge: ${selectedKnowledge}. Database: ${repository.dialect}. Server stays on loopback. No provider fallback.`);
    let closing = false;
    const shutdown = async () => {
      if (closing) return; closing = true;
      for (const server of servers) { server.close(); server.closeIdleConnections(); }
      try { await core!.close(); } finally { releaseLock?.(); }
    };
    const stop = () => { void shutdown().catch(() => { console.error('GuideKit could not finish shutting down cleanly.'); process.exitCode = 1; }); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch {
    for (const server of servers) { server.close(); server.closeIdleConnections(); }
    if (core) await core.close().catch(() => undefined);
    else await Promise.allSettled([provider?.close(), knowledge?.close?.(), knowledge ? undefined : embeddings?.close?.(), repository?.close()]);
    releaseLock?.();
    // Never print connection exceptions, URLs, credentials, user paths or raw
    // transport errors at startup. The phase is a fixed operator diagnostic.
    console.error(`GuideKit could not start during ${phase}. Check the configured model cache, database roles/schema and loopback ports. No fallback was selected.`);
    process.exitCode = 1;
  }
}
await start();
