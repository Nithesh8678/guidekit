/** Explicit synthetic inference for browser regression tests only. Never used by npm start/dev. */
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { createApp, type InferenceProvider } from '../apps/server/src/app.js';
import type { Citation, PageContext } from '../packages/contracts/src/index.js';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A worktree can test the coordinator's build; fresh CI checkouts use their own dist.
const assetRoot = process.env.GUIDEKIT_TEST_ASSET_ROOT ?? sourceRoot;
const endpoint = 'http://127.0.0.1:4510';
const dataDir = await mkdtemp(resolve(tmpdir(), 'guidekit-browser-'));

function reference<T>(prompt: string, prefix: string): T {
  const line = prompt.split('\n\n').find(value => value.startsWith(prefix));
  if (!line) throw new Error(`Test provider did not receive ${prefix}`);
  return JSON.parse(line.slice(prefix.length)) as T;
}

const provider: InferenceProvider = {
  async status() {
    return { provider: 'codex', available: false, authenticated: false, message: 'Explicit isolated browser-test provider. No live model or subscription is used.' };
  },
  async infer({ prompt, signal }) {
    signal?.throwIfAborted();
    const page = reference<PageContext>(prompt, 'Live page (reference data): ');
    const question = reference<string>(prompt, 'User request (reference data): ');
    const citations = reference<Citation[]>(prompt, 'Knowledge excerpts (reference data): ');
    const has = (name: string) => page.actions.some(action => action.name === name);
    let action: { name: string; argumentsJson: string; reason: string } | null = null;
    if (question.startsWith('Create a contact') && has('create_contact')) {
      action = { name: 'create_contact', argumentsJson: JSON.stringify({ name: question.includes('Declined') ? 'Declined Person' : 'Jamie Rivera', company: 'Acme Studio', status: 'New' }), reason: 'Create the requested synthetic contact after approval.' };
    } else if (question.startsWith('Create a support request') && has('create_ticket')) {
      action = { name: 'create_ticket', argumentsJson: JSON.stringify({ subject: 'Missing invoice', description: 'Please help locate the missing invoice.', priority: 'Normal' }), reason: 'Save the requested synthetic support request after approval.' };
    }
    const steps = /how|show/i.test(question)
      ? page.targets.filter(target => ['contact-name', 'contact-company', 'create-contact', 'ticket-subject', 'create-ticket'].includes(target.id)).map(target => ({ targetId: target.id, text: `Use ${target.label}.` }))
      : [];
    return JSON.stringify({ answer: action ? 'Review this proposed action. Nothing has been changed yet.' : citations[0]?.excerpt ?? 'Use the visible controls on this website.', steps, action, citationIds: citations.map(citation => citation.documentId) });
  },
  async close() {},
};

const service = createApp({ dataDir, provider, root: assetRoot, adminOrigins: new Set([endpoint]), testing: true });
const servers: Server[] = [];
function listen(app: ReturnType<typeof express>, port: number): Promise<void> {
  return new Promise((accept, reject) => {
    const server = app.listen(port, '127.0.0.1', () => accept());
    server.on('error', reject); servers.push(server);
  });
}
for (const [port, kind] of [[4511, 'crm'], [4512, 'support']] as const) {
  const demo = express();
  demo.use((_req, res, next) => {
    res.set('Content-Security-Policy', `default-src 'self'; script-src 'self' ${endpoint}; connect-src 'self' ${endpoint}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'`);
    next();
  });
  demo.get('/guidekit-config.js', (_req, res) => res.type('js').send(`window.__GUIDEKIT_ENDPOINT__ = ${JSON.stringify(endpoint)};`));
  demo.get('/', (_req, res) => res.sendFile(resolve(assetRoot, `apps/demo/${kind}.html`)));
  demo.use(express.static(resolve(assetRoot, 'apps/demo')));
  await listen(demo, port);
}
await listen(service.app, 4510);
console.log('Isolated browser fixture ready on 4510/4511/4512 (synthetic test provider).');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await Promise.all(servers.map(server => new Promise<void>(accept => server.close(() => accept()))));
  await service.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
