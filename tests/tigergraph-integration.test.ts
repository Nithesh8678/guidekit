import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../apps/server/src/app.js';
import { TigerGraphError, type GraphScope, type GraphSnapshot, type TigerGraphProvider } from '../packages/graph/src/index.js';

const website = 'http://127.0.0.1:4411';
const agentConfig = { name: 'Billing guide', companyName: 'Test company', description: '', instructions: '', greeting: 'Hello', accentColor: '#365cf5', allowedOrigins: [website], allowedActions: [] };
const page = { url: `${website}/`, title: 'Billing', targets: [], actions: [], context: {} };
const snapshotKey = (scope: GraphScope) => `${scope.tenantId}/${scope.agentId}/${scope.version}`;

test('HTTP graph integration uses immutable trusted scopes, augments planner evidence, and fails closed', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-graph-http-'));
  const synced = new Map<string, GraphSnapshot>(), syncCalls: GraphSnapshot[] = [], retrievalCalls: GraphScope[] = [];
  let inferCalls = 0, lastPrompt = '', citationIds: string[] = [];
  let mode: 'healthy' | 'offline' | 'forged_id' | 'forged_excerpt' | 'forged_path' = 'healthy';
  const graph: TigerGraphProvider = {
    status: async () => ({ configured: true, connected: mode !== 'offline', graphName: 'GuideKit', message: 'Explicit test graph provider.' }),
    syncVersion: async input => {
      if (mode === 'offline') throw new TigerGraphError('request_failed', 'Test graph unavailable.');
      syncCalls.push(structuredClone(input)); synced.set(snapshotKey(input), structuredClone(input)); return { vertices: 12, edges: 20 };
    },
    retrieve: async input => {
      retrievalCalls.push(input);
      const snapshot = synced.get(snapshotKey(input));
      if (mode === 'offline' || !snapshot) throw new TigerGraphError('request_failed', 'Test graph unavailable.');
      const citations = snapshot.documents.map(doc => ({ documentId: doc.id, title: doc.title, excerpt: doc.content }));
      const paths = snapshot.documents.length > 1 ? [{ nodes: [snapshot.documents[0]!.id, 'billing', snapshot.documents[1]!.id], relation: 'documents share a concept through their source chunks' }] : [];
      if (mode === 'forged_id') citations[0]!.documentId = 'foreign_document';
      if (mode === 'forged_excerpt') citations[0]!.excerpt = 'An unsupported policy from another snapshot.';
      if (mode === 'forged_path') paths[0]!.nodes[2] = 'foreign_document';
      return { source: 'tigergraph', citations, paths };
    }
  };
  const origins = new Set<string>();
  const core = createApp({ dataDir: directory, adminOrigins: origins, testing: true, graph, provider: {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit test inference provider.' }), close: async () => {},
    infer: async input => { inferCalls++; lastPrompt = input.prompt; return JSON.stringify({ answer: 'Billing statements can be exported as CSV.', steps: [], action: null, citationIds }); }
  } });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  // Isolate this integration test from native password hashing. Authentication
  // still uses a real signed, persisted express-session cookie and middleware.
  function ownerCookie(name: string) {
    const owner = core.repo.register({ email: `${name}@example.invalid`, name, companyName: name }, 'explicit-test-only-no-login-hash');
    const sid = `graph_fixture_${name}`, expires = Date.now() + 60_000;
    core.repo.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?)').run(sid, JSON.stringify({ userId: owner.user.id, cookie: { originalMaxAge: 60_000, expires: new Date(expires).toISOString(), httpOnly: true, sameSite: 'strict', path: '/' } }), expires);
    const signature = createHmac('sha256', core.repo.sessionSecret).update(sid).digest('base64').replace(/=+$/, '');
    return { owner, cookie: `gk.sid=${encodeURIComponent(`s:${sid}.${signature}`)}` };
  }
  const a = ownerCookie('owner_a'), b = ownerCookie('owner_b');
  const agent = core.repo.createAgent(a.owner.tenant.id, agentConfig);
  const first = core.repo.addDocument(a.owner.tenant.id, agent.id, { title: 'Invoice', content: 'An invoice belongs to billing.' });
  const related = core.repo.addDocument(a.owner.tenant.id, agent.id, { title: 'Statement export', content: 'Billing statements support CSV export.' });
  core.repo.publish(a.owner.tenant.id, agent.id);
  async function request(path: string, options: { cookie?: string; origin?: string; token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { Origin: options.origin ?? base };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method: options.body === undefined ? 'GET' : 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    return { status: response.status, data: await response.json() as any };
  }
  let token = '';
  const ask = (requestId: string) => request('/api/embed/session/ask', { token, origin: website, body: { message: 'invoice', requestId, page } });
  try {
    await t.test('integration status is authenticated and graph sync enforces ownership and exact input', async () => {
      assert.equal((await request('/api/integrations/status')).status, 401);
      const status = await request('/api/integrations/status', { cookie: a.cookie }); assert.equal(status.status, 200); assert.equal(status.data.tigergraph.connected, true);
      assert.equal((await request('/api/integrations/status', { cookie: a.cookie, origin: 'https://foreign.invalid' })).status, 403);
      assert.equal((await request(`/api/agents/${agent.id}/graph-sync`, { cookie: b.cookie, body: {} })).status, 404);
      assert.equal((await request(`/api/agents/${agent.id}/graph-sync`, { cookie: a.cookie, body: { tenantId: b.owner.tenant.id } })).status, 400);
      assert.equal(syncCalls.length, 0);
      const session = await request(`/api/embed/${agent.id}/session`, { origin: website, body: {} }); token = session.data.token;
    });
    await t.test('syncing an old published version reads its saved snapshot and session version stays pinned', async () => {
      core.repo.removeDocument(a.owner.tenant.id, agent.id, first.id);
      core.repo.removeDocument(a.owner.tenant.id, agent.id, related.id);
      const newer = core.repo.addDocument(a.owner.tenant.id, agent.id, { title: 'New policy', content: 'The new billing policy is different.' });
      core.repo.publish(a.owner.tenant.id, agent.id);
      const latest = await request(`/api/agents/${agent.id}/graph-sync`, { cookie: a.cookie, body: {} }); assert.equal(latest.status, 200); assert.equal(latest.data.version, 2);
      assert.deepEqual(syncCalls[0]!.documents.map(doc => doc.id), [newer.id]);
      const before = inferCalls;
      const unsynced = await ask('not_synced'); assert.equal(unsynced.status, 502); assert.match(unsynced.data.error, /sync this published version/); assert.equal(inferCalls, before);
      const old = await request(`/api/agents/${agent.id}/graph-sync`, { cookie: a.cookie, body: { version: 1 } }); assert.equal(old.status, 200); assert.equal(old.data.version, 1);
      assert.deepEqual(new Set(syncCalls[1]!.documents.map(doc => doc.id)), new Set([first.id, related.id]));
      assert.equal(syncCalls[1]!.tenantId, a.owner.tenant.id); assert.equal(syncCalls[1]!.agentId, agent.id);
    });
    await t.test('graph citations and relationship paths reach planner, result and persisted replay', async () => {
      citationIds = [first.id, related.id];
      const answer = await ask('graph_answer'); assert.equal(answer.status, 200); assert.equal(answer.data.version, 1);
      assert.equal(answer.data.knowledge.source, 'tigergraph');
      assert.equal(answer.data.citations.length, 2); assert.ok(answer.data.knowledge.paths.some((path: any) => path.nodes[1] === 'billing'));
      assert.match(lastPrompt, /Statement export/); assert.match(lastPrompt, /Knowledge relationships/); assert.match(lastPrompt, /billing/); assert.doesNotMatch(lastPrompt, /new billing policy/);
      assert.deepEqual({ tenantId: retrievalCalls.at(-1)!.tenantId, agentId: retrievalCalls.at(-1)!.agentId, version: retrievalCalls.at(-1)!.version }, { tenantId: a.owner.tenant.id, agentId: agent.id, version: 1 });
      const before = inferCalls; assert.deepEqual((await ask('graph_answer')).data, answer.data); assert.equal(inferCalls, before);
    });
    await t.test('provider outage and forged sources fail before inference without local fallback', async () => {
      mode = 'offline';
      assert.equal((await request('/api/integrations/status', { cookie: a.cookie })).data.tigergraph.connected, false);
      assert.equal((await request(`/api/agents/${agent.id}/graph-sync`, { cookie: a.cookie, body: { version: 1 } })).status, 502);
      assert.equal(core.repo.published(agent.id).version, 2);
      for (const next of ['offline', 'forged_id', 'forged_excerpt', 'forged_path'] as const) {
        mode = next; const before = inferCalls, result = await ask(`failure_${next}`);
        assert.equal(result.status, 502); assert.equal(inferCalls, before); assert.equal(result.data.citations, undefined);
      }
    });
  } finally {
    await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(directory, { recursive: true, force: true });
  }
});

test('unconfigured graph status and sync are explicit while local retrieval remains available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'guidekit-local-http-')), origins = new Set<string>();
  const core = createApp({ dataDir: directory, adminOrigins: origins, testing: true, provider: {
    status: async () => ({ provider: 'codex', available: true, authenticated: true, message: 'Explicit test provider.' }), close: async () => {},
    infer: async () => JSON.stringify({ answer: 'The invoice policy is available.', steps: [], action: null, citationIds: [] })
  } });
  const server = createServer(core.app); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; origins.add(base);
  try {
    const owner = core.repo.register({ email: 'local@example.invalid', name: 'Local owner', companyName: 'Local company' }, 'test-no-login-hash');
    const agent = core.repo.createAgent(owner.tenant.id, agentConfig);
    core.repo.addDocument(owner.tenant.id, agent.id, { title: 'Invoice policy', content: 'An invoice is available from Billing.' }); core.repo.publish(owner.tenant.id, agent.id);
    const sessionResponse = await fetch(`${base}/api/embed/${agent.id}/session`, { method: 'POST', headers: { Origin: website, 'Content-Type': 'application/json' }, body: '{}' });
    const session = await sessionResponse.json() as any;
    const response = await fetch(`${base}/api/embed/session/ask`, { method: 'POST', headers: { Origin: website, Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'invoice', requestId: 'local_answer', page }) });
    assert.equal(response.status, 200); assert.deepEqual((await response.json() as any).knowledge, { source: 'local', paths: [] });
    // Cookie-authenticated unavailable sync is covered by an explicit session.
    const sid = 'local_fixture', expires = Date.now() + 60_000;
    core.repo.db.prepare('INSERT INTO dashboard_sessions VALUES (?,?,?)').run(sid, JSON.stringify({ userId: owner.user.id, cookie: { path: '/', originalMaxAge: 60_000, expires: new Date(expires).toISOString() } }), expires);
    const signature = createHmac('sha256', core.repo.sessionSecret).update(sid).digest('base64').replace(/=+$/, '');
    const headers = { Origin: base, Cookie: `gk.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`, 'Content-Type': 'application/json' };
    const status = await fetch(`${base}/api/integrations/status`, { headers }); assert.equal((await status.json() as any).tigergraph.configured, false);
    const sync = await fetch(`${base}/api/agents/${agent.id}/graph-sync`, { method: 'POST', headers, body: '{}' }); assert.equal(sync.status, 503);
  } finally { await core.close(); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); await rm(directory, { recursive: true, force: true }); }
});
